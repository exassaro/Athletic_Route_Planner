"""PostGIS and anonymous clients (Phase 4 amendment 7).

Revision ID: 0001
Revises:
Create Date: 2026-11-18
"""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.create_table(
        "clients",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("token_hash", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("last_seen_at", sa.DateTime(timezone=True)),
        sa.PrimaryKeyConstraint("id", name="pk_clients"),
        sa.UniqueConstraint("token_hash", name="uq_clients_token_hash"),
    )


def downgrade() -> None:
    op.drop_table("clients")
    # The postgis extension stays: other databases objects may use it, and dropping it is not reversible cheaply.
