"""OSM ways and boundaries from the pinned extract (blueprint Phase 5 amendment 7, A6).

A request item for a bridge or a named road needs its OSM way ids and their geometry, and a pass-near checkpoint
needs its OSM boundary for the fallback (Phase 3 amendments 3 and 17). Photon returns only a point and an id, so
these tables hold that geometry, loaded from the pinned extract by api/scripts/load_osm_features.py. They are
OSM data from the pin, not a geocoder cache: there is still no places table (Phase 4 amendment 16).

- osm_ways: every way with a highway tag (the tap-to-pick lookup needs unnamed bridges too).
- osm_boundaries: boundary=administrative or local_authority, admin_level 8 to 10 (as the fixtures).
- osm_features_meta: which extract was loaded (checked against data/manifest.json by /v1/health).

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-18
"""

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geometry
from sqlalchemy.dialects.postgresql import JSONB

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "osm_ways",
        sa.Column("id", sa.BigInteger(), autoincrement=False, nullable=False),
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("highway", sa.Text(), nullable=False),
        sa.Column("bridge", sa.Boolean(), nullable=False),
        sa.Column("tags", JSONB(), nullable=False),
        sa.Column("geom", Geometry("LINESTRING", srid=4326, spatial_index=False), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_osm_ways"),
    )
    op.create_index("ix_osm_ways_geom", "osm_ways", ["geom"], postgresql_using="gist")
    op.create_index("ix_osm_ways_name", "osm_ways", ["name"])

    op.create_table(
        "osm_boundaries",
        sa.Column("id", sa.BigInteger(), autoincrement=False, nullable=False),
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("boundary", sa.Text(), nullable=False),
        sa.Column("admin_level", sa.Integer(), nullable=False),
        sa.Column("geom", Geometry("MULTIPOLYGON", srid=4326, spatial_index=False), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_osm_boundaries"),
    )
    op.create_index("ix_osm_boundaries_geom", "osm_boundaries", ["geom"], postgresql_using="gist")

    op.create_table(
        "osm_features_meta",
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("key", name="pk_osm_features_meta"),
    )


def downgrade() -> None:
    op.drop_table("osm_features_meta")
    op.drop_index("ix_osm_boundaries_geom", table_name="osm_boundaries")
    op.drop_table("osm_boundaries")
    op.drop_index("ix_osm_ways_name", table_name="osm_ways")
    op.drop_index("ix_osm_ways_geom", table_name="osm_ways")
    op.drop_table("osm_ways")
