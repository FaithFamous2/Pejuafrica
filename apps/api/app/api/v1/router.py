from fastapi import APIRouter

from app.api.v1.routers import (
    activity,
    admin,
    admin_email,
    admin_image_gen,
    admin_integrations,
    admin_llm,
    admin_ops,
    auth,
    billing,
    business_profile,
    marketing,
    media,
    team,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(business_profile.router)
api_router.include_router(activity.router)
api_router.include_router(marketing.router)
api_router.include_router(media.router)
api_router.include_router(billing.router)
api_router.include_router(team.router)
api_router.include_router(admin.router)
api_router.include_router(admin_llm.router)
api_router.include_router(admin_image_gen.router)
api_router.include_router(admin_email.router)
api_router.include_router(admin_integrations.router)
api_router.include_router(admin_ops.router)
