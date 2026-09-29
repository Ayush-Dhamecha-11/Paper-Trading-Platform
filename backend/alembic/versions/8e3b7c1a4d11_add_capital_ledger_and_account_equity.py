"""separate cash capital from holdings value and add capital ledger

Revision ID: 8e3b7c1a4d11
Revises: cbf2d19fc4fe
Create Date: 2026-09-29 14:40:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "8e3b7c1a4d11"
down_revision: Union[str, Sequence[str], None] = "cbf2d19fc4fe"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # `portfolio_snapshots.portfolio_value` historically stored full account
    # equity. Rename it so snapshot data stays semantically correct.
    op.alter_column(
        "portfolio_snapshots",
        "portfolio_value",
        new_column_name="account_equity",
    )

    op.add_column(
        "portfolio_snapshots",
        sa.Column("portfolio_value", sa.Numeric(), nullable=True),
    )

    op.create_table(
        "capital_transactions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("amount", sa.Numeric(), nullable=False),
        sa.Column("transaction_type", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("description", sa.String(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )

    # Existing portfolios already had `initial_capital`, so seed one deposit
    # transaction per account to establish the historical external-capital base.
    op.execute(
        sa.text(
            """
            INSERT INTO capital_transactions
                (id, user_id, amount, transaction_type, created_at, description)
            SELECT
                gen_random_uuid(),
                user_id,
                initial_capital,
                'deposit',
                created_at,
                'Initial paper-trading capital (backfilled)'
            FROM portfolios
            """
        )
    )

    # Existing snapshot account-equity values were stored in the renamed column.
    # Holdings value cannot be reconstructed safely during a schema migration
    # without the same market-price logic used by the application, so initialise
    # it to zero; the snapshot rebuild command will repopulate correct EOD values.
    op.execute(
        sa.text(
            "UPDATE portfolio_snapshots SET portfolio_value = 0 "
            "WHERE portfolio_value IS NULL"
        )
    )
    op.alter_column(
        "portfolio_snapshots",
        "portfolio_value",
        nullable=False,
    )


def downgrade() -> None:
    # Restore the old snapshot column name and remove the capital ledger.
    op.drop_table("capital_transactions")
    op.drop_column("portfolio_snapshots", "portfolio_value")
    op.alter_column(
        "portfolio_snapshots",
        "account_equity",
        new_column_name="portfolio_value",
    )
