# Private Alpha Checklist (Phase 5)

## Before inviting SMEs

- [ ] Set strong `SECRET_KEY` (32+ chars)
- [ ] Confirm Postgres + Redis via `GET /ready`
- [ ] Optional: set `OPENAI_API_KEY` for live LLM generation
- [ ] Optional: set Paystack/Flutterwave webhook secrets
- [ ] Change bootstrap super admin password
- [ ] Walk through: register → onboard → generate → approve → export
- [ ] Confirm suspended tenant cannot call tenant APIs
- [ ] Confirm rate limit returns 429 on auth spam

## Success metrics to watch

- Time to first campaign < 10 minutes
- Onboarding completion rate
- Draft → approved conversion
- Weekly active workspaces
