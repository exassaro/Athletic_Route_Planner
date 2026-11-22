"""Database tables (SQLAlchemy 2) and the async session factory.

The Alembic migrations in api/alembic/ are the authority for the schema (blueprint section 11);
these classes mirror them and the tests compare the two.
"""

import uuid
from datetime import datetime

from typing import Any

from geoalchemy2 import Geography, Geometry
from sqlalchemy import (BigInteger, Boolean, CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, LargeBinary, MetaData,
                        Text, UniqueConstraint, func)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

SOURCES = ("form", "chat", "drag")
OUTCOMES = ("ok", "over_budget", "infeasible", "disconnected", "unsupported")   # SolveResult.outcome
TZ = DateTime(timezone=True)


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention={
        "ix": "ix_%(column_0_label)s", "uq": "uq_%(table_name)s_%(column_0_name)s",
        "ck": "ck_%(table_name)s_%(constraint_name)s", "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
        "pk": "pk_%(table_name)s"})


class Client(Base):
    """An anonymous client (Phase 4 amendment 7). Only the token's sha256 is stored."""

    __tablename__ = "clients"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Plan(Base):
    """One planning session, owned by a client."""

    __tablename__ = "plans"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    client_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clients.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(TZ, server_default=func.now())


class PlanVersion(Base):
    """One solve: the create, each patch, each undo (Phase 4 amendments 4, 6, 14)."""

    __tablename__ = "plan_versions"
    __table_args__ = (
        UniqueConstraint("plan_id", "version_no", name="uq_plan_versions_plan_id_version_no"),
        CheckConstraint(_in("source", SOURCES), name="source"),
        CheckConstraint(_in("outcome", OUTCOMES), name="outcome"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("plans.id", ondelete="CASCADE"))
    version_no: Mapped[int] = mapped_column(Integer)
    request: Mapped[dict[str, Any]] = mapped_column(JSONB)             # the full RouteRequest, defaults filled in
    source: Mapped[str] = mapped_column(Text)
    user_text: Mapped[str | None] = mapped_column(Text)                # chat only (Phase 6)
    outcome: Mapped[str] = mapped_column(Text)
    conflict: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    facts: Mapped[dict[str, Any]] = mapped_column(JSONB)               # SolveResult.facts, unchanged
    flags: Mapped[list[Any]] = mapped_column(JSONB)                    # SolveResult.flags
    explanation: Mapped[str] = mapped_column(Text)
    diff: Mapped[dict[str, Any] | None] = mapped_column(JSONB)         # against version_no - 1
    graph_build: Mapped[str] = mapped_column(Text)                     # OSM pin, as the solver reports it
    valhalla_build: Mapped[str] = mapped_column(Text)
    graphhopper_build: Mapped[str | None] = mapped_column(Text)        # null when GraphHopper was down
    solver_hash: Mapped[str] = mapped_column(Text)
    cache_key: Mapped[str] = mapped_column(Text)
    from_cache: Mapped[bool] = mapped_column(Boolean)
    elapsed_ms: Mapped[float | None] = mapped_column(Float)            # the solver's own time
    engine_calls: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(TZ, server_default=func.now())


class Route(Base):
    """One Candidate of a version. Every length is the solver's measurement, stored as it came (amendment 4)."""

    __tablename__ = "routes"
    __table_args__ = (
        UniqueConstraint("plan_version_id", "seq", name="uq_routes_plan_version_id_seq"),
        Index("ix_routes_geom", "geom", postgresql_using="gist"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    plan_version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("plan_versions.id", ondelete="CASCADE"))
    seq: Mapped[int] = mapped_column(Integer)                          # position in SolveResult.candidates
    label: Mapped[str] = mapped_column(Text)
    option: Mapped[str] = mapped_column(Text)
    engine: Mapped[str] = mapped_column(Text)
    geom: Mapped[Any] = mapped_column(Geography("LINESTRINGZ", srid=4326, spatial_index=False))  # Z: DEM height
    length_m: Mapped[float] = mapped_column(Float)
    foot_m: Mapped[float] = mapped_column(Float)
    ferry_m: Mapped[float] = mapped_column(Float)
    engine_length_m: Mapped[float] = mapped_column(Float)
    sphere_length_m: Mapped[float] = mapped_column(Float)
    edge_count: Mapped[int] = mapped_column(Integer)
    deviation_m: Mapped[float] = mapped_column(Float)
    duration_s: Mapped[float | None] = mapped_column(Float)            # engine walking time (amendment 11)
    gain_m: Mapped[float | None] = mapped_column(Float)                # the solver's smoothed values
    loss_m: Mapped[float | None] = mapped_column(Float)
    repeat_share: Mapped[float | None] = mapped_column(Float)
    backtrack_share: Mapped[float | None] = mapped_column(Float)
    score: Mapped[float | None] = mapped_column(Float)
    end_label: Mapped[str | None] = mapped_column(Text)
    end_point: Mapped[dict[str, Any]] = mapped_column(JSONB)           # Candidate.end
    stops: Mapped[list[Any]] = mapped_column(JSONB)                    # Candidate.stops
    road_class_m: Mapped[dict[str, Any]] = mapped_column(JSONB)
    flags: Mapped[list[Any]] = mapped_column(JSONB)                    # Candidate.flags
    bridges_m: Mapped[list[Any] | None] = mapped_column(JSONB)         # Candidate.bridges_m (Phase 5 amendment 13)
    elevation: Mapped[list[Any] | None] = mapped_column(JSONB)         # [[distance_m, height_m], ...] every 30 m (amendment 15)


class SavedRoute(Base):
    __tablename__ = "saved_routes"
    __table_args__ = (
        CheckConstraint("rating BETWEEN 1 AND 5", name="rating"),
        Index("ix_saved_routes_client_id_deleted_at", "client_id", "deleted_at"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    client_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clients.id"), index=True)
    route_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("routes.id"))
    name: Mapped[str | None] = mapped_column(Text)
    share_slug: Mapped[str] = mapped_column(Text, unique=True)
    rating: Mapped[int | None] = mapped_column(Integer)                # post-run feedback (later phases)
    feedback: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TZ, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TZ, server_default=func.now())   # rename or update, not delete/restore
    deleted_at: Mapped[datetime | None] = mapped_column(TZ)            # soft delete (Phase 5c amendment 1)


class OsmWay(Base):
    """A highway way from the pinned extract (Phase 5 A6): ids and geometry for bridges and named roads."""

    __tablename__ = "osm_ways"
    __table_args__ = (Index("ix_osm_ways_geom", "geom", postgresql_using="gist"),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    name: Mapped[str | None] = mapped_column(Text, index=True)
    highway: Mapped[str] = mapped_column(Text)
    bridge: Mapped[bool] = mapped_column(Boolean)
    tags: Mapped[dict[str, Any]] = mapped_column(JSONB)
    geom: Mapped[Any] = mapped_column(Geometry("LINESTRING", srid=4326, spatial_index=False))


class OsmBoundary(Base):
    """An administrative or local-authority boundary, admin_level 8 to 10 (the pass-near fallback)."""

    __tablename__ = "osm_boundaries"
    __table_args__ = (Index("ix_osm_boundaries_geom", "geom", postgresql_using="gist"),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)   # relation id
    name: Mapped[str | None] = mapped_column(Text)
    boundary: Mapped[str] = mapped_column(Text)
    admin_level: Mapped[int] = mapped_column(Integer)
    geom: Mapped[Any] = mapped_column(Geometry("MULTIPOLYGON", srid=4326, spatial_index=False))


class OsmFeaturesMeta(Base):
    """Which extract osm_ways and osm_boundaries came from (name, md5, osm_timestamp, loaded_at, counts)."""

    __tablename__ = "osm_features_meta"
    key: Mapped[str] = mapped_column(Text, primary_key=True)
    value: Mapped[str] = mapped_column(Text)


def make_engine(url: str) -> AsyncEngine:
    return create_async_engine(url, pool_size=5, max_overflow=5, pool_pre_ping=True)


def make_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)
