"""
Single shared declarative Base for all SQLAlchemy models.

alembic/env.py can import Base.metadata without also importing every model module directly -
"""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass