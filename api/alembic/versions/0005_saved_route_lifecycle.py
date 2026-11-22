"""saved_routes.deleted_at and updated_at (blueprint Phase 5c amendment 5).

deleted_at: soft delete; null while the saved route is live. updated_at: the last rename or update, backfilled from
created_at. Neither touches routes or plan versions.

The downgrade DELETES soft-deleted saved routes before it drops the column. Without that, dropping deleted_at
would make them live again and republish share links their owners deleted. It cannot be undone.

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-22
"""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

TZ = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.add_column("saved_routes", sa.Column("deleted_at", TZ, nullable=True))
    op.add_column("saved_routes", sa.Column("updated_at", TZ, nullable=True))
    op.execute("UPDATE saved_routes SET updated_at = created_at")
    op.alter_column("saved_routes", "updated_at", nullable=False, server_default=sa.func.now())
    op.create_index("ix_saved_routes_client_id_deleted_at", "saved_routes", ["client_id", "deleted_at"])


def downgrade() -> None:
    op.execute("DELETE FROM saved_routes WHERE deleted_at IS NOT NULL")
    op.drop_index("ix_saved_routes_client_id_deleted_at", table_name="saved_routes")
    op.drop_column("saved_routes", "updated_at")
    op.drop_column("saved_routes", "deleted_at")
