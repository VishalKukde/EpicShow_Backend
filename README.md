<div align="center">

# EpicShow Backend

Realtime booking APIs and infrastructure for the EpicShow platform.

Built to power movies, sports, events, and gaming from one backend.

`Node.js` `Express 5` `MongoDB` `Redis` `Socket.IO` `Razorpay`

Pairs with the [EpicShow Frontend](../EpicShow_Frontend/README.md)

</div>

## Features

| Feature | What it covers |
| --- | --- |
| Multi-category booking engine | Handles movies, sports, events, and gaming in one service |
| Secure auth flow | Register, login, refresh token rotation, logout, and password change |
| Session invalidation | Uses `tokenVersion` to force clean re-login after sensitive actions |
| Realtime seat locking | Redis-backed seat locks with live updates over Socket.IO |
| Multi-instance realtime sync | Redis Pub/Sub keeps seat events in sync across backend instances |
| Payment lifecycle | Prepare payment, create Razorpay order, verify success, and mark failures |
| Wallet and rewards | Wallet top-up, wallet pay, reward earning, reward redemption, and bonus credits |
| Booking management | Booking history, booking details, latest bookings, stats, and cancellation |
| Wishlist and discovery | Wishlist endpoints plus TMDB proxy routes for movie discovery |
| Support chat | Realtime user/admin chat with REST history and socket events |
| Statement export | Excel export for transaction and payment reporting |
| Deployment helpers | Health checks, error middleware, CORS allowlist, and Redis fallbacks |

## Tech Stack

| Layer | Tools |
| --- | --- |
| Runtime | Node.js with ES Modules |
| API framework | Express 5 |
| Database | MongoDB with Mongoose |
| Cache and locking | Redis |
| Realtime | Socket.IO |
| Authentication | JWT, HttpOnly refresh cookies, `bcryptjs` |
| Payments | Razorpay |
| Email | Resend |
| Reporting | `exceljs` |
| Core middleware | `cors`, `cookie-parser`, custom auth and error middleware |

## Quick Start

### Prerequisites

- Node.js `18+`
- MongoDB
- Redis
- Razorpay account credentials for payment flows

### Run locally

```bash
cd EpicShow_Backend
cp .env.example .env
npm install
npm run dev
```

The API starts on `http://localhost:5000` unless `PORT` is overridden.

## Environment Variables

Use `.env.example` as your starting point, then replace sample values with your own credentials.

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | No | API port. Defaults to `5000` |
| `NODE_ENV` | No | Environment mode |
| `MONGO_URI` | Yes | MongoDB connection string |
| `JWT_SECRET` | Yes | Access token signing secret |
| `JWT_REFRESH_SECRET` | Yes | Refresh token signing secret |
| `RAZORPAY_KEY_ID` | Yes | Razorpay key id |
| `RAZORPAY_SECRET` | Yes | Razorpay secret |
| `REDIS_URL` | Yes | Redis connection string for cache, locks, and Pub/Sub |
| `CORS_ORIGINS` | No | Extra allowed frontend origins, comma-separated |
| `RESEND_API_KEY` | No | Needed for email notifications |
| `EMAIL_FROM` | No | Sender address for email notifications |
| `TMDB_BEARER_TOKEN` | No | Preferred TMDB token for `/tmdb/*` routes |
| `NEXT_PUBLIC_TMDB_BEARER_TOKEN` | No | Fallback TMDB token name supported by the codebase |
| `SEAT_LOCK_TTL_SECONDS` | No | Seat lock TTL in seconds |

## API Overview

| Area | Main routes |
| --- | --- |
| Health | `GET /health`, `GET /api/health` |
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `PUT /auth/change-password` |
| Profile | `GET /profile/me`, `PUT /profile/update-profile` |
| Movies | `GET /movies`, `GET /movies/latest`, `GET /movies/:id`, `POST /movies` |
| Wishlist | `POST /wishlist`, `GET /getwishlist` |
| Seats | `GET /seat/:cinemaId`, `POST /seat/lock`, `POST /seat/unlock` |
| Movie payments | `POST /payment/prepare`, `POST /payment/create-order`, `POST /payment/verify`, `POST /payment/fail`, `POST /payment/wallet-pay`, `GET /payment/transactions`, `POST /payment/export-statement` |
| Movie bookings | `GET /bookings/movies`, `GET /bookings/stats`, `GET /bookings/latest`, `GET /booking/:id`, `PATCH /cancel/:id` |
| Sports | `GET /sports`, `GET /sports/:id`, `GET /sports/teams`, `POST /sports`, plus `/sports/payment/*` and `/bookings/sports` |
| Events | `GET /events`, `GET /events/:id`, `POST /events`, plus `/events/payment/*` and `/bookings/events` |
| Gaming | `GET /gaming`, `GET /gaming/:id`, `POST /gaming`, plus `/gaming/payment/*` and `/bookings/gaming` |
| Wallet | `POST /wallet/create-order`, `POST /wallet/verify`, `GET /wallet/transactions` |
| Chat | `GET /chat/users`, `GET /chat/messages`, `GET /chat/messages/:userId`, `DELETE /chat/messages` |
| TMDB proxy | `GET /tmdb/upcoming`, `GET /tmdb/movie/:id` |

## How It Works

### Authentication

- Access tokens can be sent as `Authorization: Bearer <token>`.
- Refresh tokens are stored as HttpOnly cookies and used for refresh flow.
- Password changes bump `tokenVersion`, which invalidates old sessions cleanly.

### Realtime seat updates

- Clients join the `/shows` namespace for a show-specific room.
- Seats are locked in Redis using atomic lock semantics.
- The backend broadcasts `seat_locked`, `seat_unlocked`, and `seat_booked`.
- Redis Pub/Sub bridges those events across multiple backend instances.

### Payments and bookings

- The backend validates locks before creating or verifying payments.
- Razorpay success handlers finalize bookings and release seat locks.
- Idempotent payment processing helps prevent duplicate booking finalization.

## Project Structure

```text
EpicShow_Backend/
  server.js
  config/
    redis.js
    razorpay.js
  middleware/
    auth.middleware.js
    requireAccessToken.middleware.js
    error.middleware.js
  modules/
    auth/
    user/
    movies/
    sports/
    event/
    gaming/
    wallet/
    chat/
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the backend with `nodemon` |
| `npm start` | Start the backend with Node.js |
| `npm test` | Placeholder script, not configured yet |

## Notes

- Redis is a core part of the booking experience, not just an optional cache.
- For safer local sharing, replace any sample secrets in `.env.example` before committing or deploying.
