"""Plans, versions, routes and saved routes (blueprint section 11, Phase 4 amendment 4).

Lengths are double precision so the solver's floats come back exactly. Route geometry is
geography(LineStringZ, 4326): the solver's (lon, lat) with the DEM height as Z (amendment 15).

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-18
"""

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geography
from sqlalchemy.dialects.postgresql import JSONB

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

TZ = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "plans",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("client_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", TZ, nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id", name="pk_plans"),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], name="fk_plans_client_id_clients"),
    )
    op.create_index("ix_plans_client_id", "plans", ["client_id"])

    op.create_table(
        "plan_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("plan_id", sa.Uuid(), nullable=False),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("request", JSONB(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("user_text", sa.Text()),
        sa.Column("outcome", sa.Text(), nullable=False),
        sa.Column("conflict", JSONB()),
        sa.Column("facts", JSONB(), nullable=False),
        sa.Column("flags", JSONB(), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column("diff", JSONB()),
        sa.Column("graph_build", sa.Text(), nullable=False),
        sa.Column("valhalla_build", sa.Text(), nullable=False),
        sa.Column("graphhopper_build", sa.Text()),
        sa.Column("solver_hash", sa.Text(), nullable=False),
        sa.Column("cache_key", sa.Text(), nullable=False),
        sa.Column("from_cache", sa.Boolean(), nullable=False),
        sa.Column("elapsed_ms", sa.Float()),
        sa.Column("engine_calls", sa.Integer()),
        sa.Column("created_at", TZ, nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id", name="pk_plan_versions"),
        sa.ForeignKeyConstraint(["plan_id"], ["plans.id"], name="fk_plan_versions_plan_id_plans", ondelete="CASCADE"),
        sa.UniqueConstraint("plan_id", "version_no", name="uq_plan_versions_plan_id_version_no"),
        sa.CheckConstraint("source IN ('form', 'chat', 'drag')", name="ck_plan_versions_source"),
        sa.CheckConstraint("outcome IN ('ok', 'over_budget', 'infeasible', 'disconnected', 'unsupported')",
                           name="ck_plan_versions_outcome"),
    )

    op.create_table(
        "routes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("plan_version_id", sa.Uuid(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("option", sa.Text(), nullable=False),
        sa.Column("engine", sa.Text(), nullable=False),
        sa.Column("geom", Geography("LINESTRINGZ", srid=4326, spatial_index=False), nullable=False),
        sa.Column("length_m", sa.Float(), nullable=False),
        sa.Column("foot_m", sa.Float(), nullable=False),
        sa.Column("ferry_m", sa.Float(), nullable=False),
        sa.Column("engine_length_m", sa.Float(), nullable=False),
        sa.Column("sphere_length_m", sa.Float(), nullable=False),
        sa.Column("edge_count", sa.Integer(), nullable=False),
        sa.Column("deviation_m", sa.Float(), nullable=False),
        sa.Column("duration_s", sa.Float()),
        sa.Column("gain_m", sa.Float()),
        sa.Column("loss_m", sa.Float()),
        sa.Column("repeat_share", sa.Float()),
        sa.Column("backtrack_share", sa.Float()),
        sa.Column("score", sa.Float()),
        sa.Column("end_label", sa.Text()),
        sa.Column("end_point", JSONB(), nullable=False),
        sa.Column("stops", JSONB(), nullable=False),
        sa.Column("road_class_m", JSONB(), nullable=False),
        sa.Column("flags", JSONB(), nullable=False),
        sa.Column("elevation", JSONB()),
        sa.PrimaryKeyConstraint("id", name="pk_routes"),
        sa.ForeignKeyConstraint(["plan_version_id"], ["plan_versions.id"],
                                name="fk_routes_plan_version_id_plan_versions", ondelete="CASCADE"),
        sa.UniqueConstraint("plan_version_id", "seq", name="uq_routes_plan_version_id_seq"),
    )
    op.create_index("ix_routes_geom", "routes", ["geom"], postgresql_using="gist")

    op.create_table(
        "saved_routes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("client_id", sa.Uuid(), nullable=False),
        sa.Column("route_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.Text()),
        sa.Column("share_slug", sa.Text(), nullable=False),
        sa.Column("rating", sa.Integer()),
        sa.Column("feedback", sa.Text()),
        sa.Column("created_at", TZ, nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id", name="pk_saved_routes"),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], name="fk_saved_routes_client_id_clients"),
        sa.ForeignKeyConstraint(["route_id"], ["routes.id"], name="fk_saved_routes_route_id_routes"),
        sa.UniqueConstraint("share_slug", name="uq_saved_routes_share_slug"),
        sa.CheckConstraint("rating BETWEEN 1 AND 5", name="ck_saved_routes_rating"),
    )
    op.create_index("ix_saved_routes_client_id", "saved_routes", ["client_id"])


def downgrade() -> None:
    op.drop_table("saved_routes")
    op.drop_table("routes")
    op.drop_table("plan_versions")
    op.drop_table("plans")
