"""CardVault backend entry point.

All product logic lives under `routes/`. This file only wires them into a
single `/api` prefix, sets CORS, and manages MongoDB lifecycle.
"""
from __future__ import annotations

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from deps import close_db, logger
from routes.ai import router as ai_router
from routes.analytics import router as analytics_router
from routes.auth import router as auth_router
from routes.billing import router as billing_router
from routes.campaigns import router as campaigns_router
from routes.contacts import router as contacts_router
from routes.email_settings import router as email_settings_router
from routes.excel import router as excel_router
from routes.templates import router as templates_router
from routes.whatsapp import router as whatsapp_router

app = FastAPI(title="CardVault API", version="1.0.0")

# Single /api umbrella so ingress rules and legacy clients keep working.
api = APIRouter(prefix="/api")
api.include_router(auth_router)
api.include_router(contacts_router)
api.include_router(ai_router)
api.include_router(email_settings_router)
api.include_router(templates_router)
api.include_router(campaigns_router)
api.include_router(analytics_router)
api.include_router(billing_router)
api.include_router(excel_router)
api.include_router(whatsapp_router)

app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _startup() -> None:
    logger.info("CardVault backend ready")


@app.on_event("shutdown")
async def _shutdown() -> None:
    close_db()
