"""client_tokens: more than one token per anonymous client (Step 9, "Use on another device").

A second browser joins a client with a one-time code (POST /v1/session/link, then /v1/session/claim) and gets a
token of its own for the same client_id. Those tokens live here. clients.token_hash is unchanged and still
accepted, so every existing token keeps working with no data change.

Only adds a table. The downgrade drops it: every linked device's token stops working (that browser then gets a
new, empty client on its next request). The first device's token (clients.token_hash) is not affected.

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-25
"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "client_tokens",
        sa.Column("token_hash", sa.LargeBinary(), nullable=False),
        sa.Column("client_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("label", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("token_hash", name="pk_client_tokens"),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], name="fk_client_tokens_client_id_clients",
                                ondelete="CASCADE"),
    )
    op.create_index("ix_client_tokens_client_id", "client_tokens", ["client_id"])


def downgrade() -> None:
    op.drop_index("ix_client_tokens_client_id", table_name="client_tokens")
    op.drop_table("client_tokens")
