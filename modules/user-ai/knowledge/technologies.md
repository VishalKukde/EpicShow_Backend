# Technologies & System Architecture

## Full-Stack Technology Stack
EpicShow is engineered using a robust modern JavaScript and TypeScript ecosystem spanning frontend client, backend micro-services, distributed data stores, and generative AI pipelines.

### Frontend Client Architecture
- **Framework**: Next.js 15+ (App Router architecture with React Server Components & Client Components).
- **Core Library**: React 19.
- **Language**: TypeScript (strict type checking enabled throughout).
- **Styling & UI**: Tailwind CSS with custom HSL theme tokens, smooth glassmorphism, responsive drawers, and curated dark/light modes.
- **State Management**: Redux Toolkit (RTK) for global booking flows, authentication state, and theme management; Zustand for modular UI stores.
- **Icons & Animation**: Lucide React for consistent modern iconography; Framer Motion for smooth layout transitions and drawer animations.
- **Real-Time Client**: Socket.io Client for live seat map updates and customer care chat.
- **Payment SDK**: Razorpay Checkout integration for UPI, card, and net banking processing.

### Backend Infrastructure & APIs
- **Runtime**: Node.js (v20+ with native ES Modules `type: module`).
- **Web Framework**: Express.js 5.
- **Database & ODM**: MongoDB with Mongoose ODM (structured schemas for users, movies, cinemas, seats, bookings, trains, sports, gaming, and payments).
- **In-Memory Cache & Locking**: Redis (ioredis / node-redis) for fast session retrieval, movie cache, and distributed seat locking concurrency.
- **Real-Time Engine**: Socket.io Server powering two dedicated socket namespaces:
  - `show.socket.js`: Live seat occupancy, real-time seat lock timers, and broadcast releases.
  - `chat.socket.js`: Live customer care support messaging and presence tracking.
- **Authentication & Security**: JSON Web Tokens (JWT) with dual storage (Authorization headers and HTTP-only cookies), bcryptjs password salting, CORS security policies, and rate-limiting middlewares.
- **Email Delivery**: Resend API for transactional e-ticket delivery and password reset notifications.

### AI & RAG (Retrieval-Augmented Generation) Stack
- **AI SDK**: Google Gen AI SDK (`@google/genai`).
- **Generation Models**: Primary model `gemini-2.5-flash` with ultra-low latency fallback to `gemini-2.5-flash-lite` and `gemini-3.5-flash`.
- **Embedding Model**: `gemini-embedding-001` producing high-dimensional dense vector embeddings for semantic document retrieval.
- **Vector Search Engine**: In-memory vector store computing normalized cosine similarity with hybrid keyword fallback matching.
- **Cache & Invalidation**: Incremental SHA-256 content hashing in `embeddings-cache.json`. Embeddings are computed strictly for new or edited Markdown chunks, preserving API quota and boot speed.
- **Streaming Response Protocol**: Server-Sent Events (SSE) streaming model tokens in real time directly to the Ask Epic AI chat interface.
