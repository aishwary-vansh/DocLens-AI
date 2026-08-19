# Comprehensive Cleanup Plan

This plan outlines the final steps to fully clean up leftover internal hooks, webhooks, unused environment configurations, and documentation related to the removed `ai-service`.

## Proposed Changes

### 1. Remove Unnecessary Environment Variables
We will strip out all unused AI-related variables (`AI_SERVICE_URL`, `AI_DATABASE_URL`, `NESTJS_CALLBACK_URL`, `INTERNAL_API_SECRET`, `OPENROUTER_API_KEY`) from our `.env` files since the app is now fully localized.

#### [MODIFY] [.env.example](file:///d:/DockerData/Doclens/.env.example)
#### [MODIFY] [backend/.env.example](file:///d:/DockerData/Doclens/backend/.env.example)
#### [MODIFY] [backend/.env](file:///d:/DockerData/Doclens/backend/.env)

---

### 2. Simplify Document Processing
Previously, the `DocumentProcessingQueueService` relied on `AiProxyService` to send a webhook that then updated document statuses. We will bypass this entirely. The queue will now just directly update the database locally to mark documents as `COMPLETED`. This lets us completely detach from the webhook flow.

#### [MODIFY] [document-processing-queue.service.ts](file:///d:/DockerData/Doclens/backend/src/processing/document-processing-queue.service.ts)
#### [MODIFY] [processing.module.ts](file:///d:/DockerData/Doclens/backend/src/processing/processing.module.ts)
*(Removing the `AiProxyModule` dependency since it's no longer needed for processing).*

---

### 3. Clean up the AI Proxy
The simulated webhook logic can now be safely removed from `AiProxyService`, making the file much cleaner. It will strictly contain simple local offline responses for chat and queries.

#### [MODIFY] [ai-proxy.service.ts](file:///d:/DockerData/Doclens/backend/src/ai-proxy/ai-proxy.service.ts)

---

### 4. Delete Unnecessary Modules & Files
Since we bypassed the webhook flow, the `internal` module (which listened for webhook requests from the `ai-service`) is completely obsolete. The AI documentation is also obsolete.

#### [MODIFY] [app.module.ts](file:///d:/DockerData/Doclens/backend/src/app.module.ts)
*(Removing `InternalModule` from imports)*
#### [DELETE] [backend/src/internal/](file:///d:/DockerData/Doclens/backend/src/internal)
#### [DELETE] [docs/AI_INTELLIGENCE_LAYER.md](file:///d:/DockerData/Doclens/docs/AI_INTELLIGENCE_LAYER.md)

## Verification Plan
1. Delete the files and make the code modifications.
2. Restart the NestJS development server.
3. Verify that the backend compiles cleanly without `InternalModule` or `ai-proxy` dependencies in the queue service.
