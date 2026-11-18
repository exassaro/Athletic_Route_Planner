"""routes.bridges_m: where the route crosses bridges (blueprint Phase 5 amendment 13).

The solver's Candidate.bridges_m, [from_m, to_m] along the route; the climb and the smoothed profile bridge the
heights there. Null for routes stored before the column existed (their profile is smoothed without bridging).

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-18
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("routes", sa.Column("bridges_m", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("routes", "bridges_m")
