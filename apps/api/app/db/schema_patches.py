"""One-off / idempotent schema patches for local create_all drift."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection


async def apply_schema_patches(conn: AsyncConnection) -> None:
    """
    Fix billing_events.provider when an older create_all left a mismatched
    Postgres enum (billing_event_provider vs payment_provider / varchar).
    Also add newer columns that create_all won't alter onto existing tables.
    """
    await conn.execute(
        text(
            """
            DO $$
            BEGIN
              IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'billing_events'
                  AND column_name = 'provider'
                  AND udt_name IN ('billing_event_provider', 'payment_provider')
              ) THEN
                ALTER TABLE billing_events
                  ALTER COLUMN provider DROP DEFAULT;
                ALTER TABLE billing_events
                  ALTER COLUMN provider TYPE varchar(40)
                  USING provider::text;
                ALTER TABLE billing_events
                  ALTER COLUMN provider SET DEFAULT 'none';
              END IF;

              IF EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'campaigns'
              ) THEN
                ALTER TABLE campaigns
                  ADD COLUMN IF NOT EXISTS generation_provider varchar(40);
                ALTER TABLE campaigns
                  ADD COLUMN IF NOT EXISTS generation_model varchar(120);
              END IF;

              IF EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'business_profiles'
              ) THEN
                ALTER TABLE business_profiles
                  ADD COLUMN IF NOT EXISTS logo_url varchar(512);
              END IF;

              IF EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'content_posts'
              ) THEN
                ALTER TABLE content_posts
                  ADD COLUMN IF NOT EXISTS graphic_url varchar(512);
              END IF;

              IF EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'media_assets'
              ) THEN
                ALTER TABLE media_assets
                  ADD COLUMN IF NOT EXISTS meta_json jsonb;
              END IF;

              IF EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'memberships'
              ) THEN
                ALTER TABLE memberships
                  ADD COLUMN IF NOT EXISTS permissions_json jsonb;
              END IF;

              -- Expand membership_role enum for team invites
              BEGIN
                ALTER TYPE membership_role ADD VALUE IF NOT EXISTS 'editor';
              EXCEPTION WHEN duplicate_object THEN NULL;
              END;
              BEGIN
                ALTER TYPE membership_role ADD VALUE IF NOT EXISTS 'generator';
              EXCEPTION WHEN duplicate_object THEN NULL;
              END;
            END $$;
            """
        )
    )
