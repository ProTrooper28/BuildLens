/**
 * Concept lexicon for claim comparison.
 *
 * A claim rarely contains the words that live in the evidence: the team writes
 * "we implemented Google authentication", while the repository offers a file
 * called `src/auth/login.ts` and a declared `next-auth` dependency. Each entry
 * below bridges one such gap, and it only ever *helps* — a concept contributes
 * nothing unless some real, readable evidence backs it:
 *
 *   observationIds — structured findings (`repo.code.auth`, `site.functionality.auth`)
 *   dependencies   — names in a config segment (package.json, requirements.txt, …)
 *   paths          — repository paths in an implementation segment
 *   runtime        — text literally visible on the deployed page
 *
 * Documentation (a README) can never back a concept: documentation segments are
 * never consulted here. A claim whose concept stays unbacked is simply matched
 * on tokens like any other claim, which is how a claim about a feature that is
 * absent ends up NOT FOUND instead of being waved through.
 */

export interface EvidenceConcept {
  id: string;
  /** Plain-language name, used in explanations. */
  label: string;
  /** Does the claim assert this concept? */
  claim: RegExp;
  /** Claim words this concept accounts for once it is backed. */
  covers: RegExp;
  /** Structured observation ids that prove it (status good/info only). */
  observationIds?: readonly string[];
  /** Dependency names that prove it (config segments). */
  dependencies?: RegExp;
  /** Repository paths that prove it (implementation segments). */
  paths?: RegExp;
  /** Visible UI text that proves it (runtime segments only). */
  runtime?: RegExp;
}

export const EVIDENCE_CONCEPTS: EvidenceConcept[] = [
  {
    id: "auth",
    label: "authentication",
    claim:
      /\b(auth\w*|authorization|authorisation|login|log ?in|log ?on|sign ?in|sign ?up|oauth|sso|password|accounts?|jwt|session|identity)\b/i,
    covers:
      /\b(auth\w*|authorization|authorisation|login|log ?in|log ?on|sign ?in|sign ?up|oauth|sso|password|account|accounts|jwt|session|identity)\b/i,
    observationIds: ["repo.code.auth", "site.functionality.auth"],
    dependencies:
      /\b(next-auth|@auth\/core|@auth0\/[\w-]+|passport|passport-[\w-]+|jsonwebtoken|jwt|bcrypt|bcryptjs|@clerk\/[\w-]+|lucia|iron-session|express-session|flask-login|django-allauth|python-jose|pyjwt|firebase-admin|@supabase\/ssr|oauth)\b/i,
    paths: /(^|\/)(auth|auth\.config|authorize|login|signin|session|oauth|middleware)[^/]*\.(ts|tsx|js|jsx|mjs|py|go|rb|java|kt|swift|php)$/i,
    runtime:
      /\b(log ?in|log ?on|sign ?in|sign ?up|register|create account|forgot password|continue with (google|github|email))\b/i,
  },
  {
    id: "ai",
    label: "AI / machine learning",
    claim:
      /\b(ai|a\.i\.|artificial intelligence|machine learning|ml|llms?|gpt|chatbot\w*|neural|models?|inference|recommendations?|computer vision|ocr|nlp|datasets?|training|predictions?)\b/i,
    covers:
      /\b(ai|artificial intelligence|machine learning|ml|llms?|gpt|chatbot|chatbots|neural|model|models|inference|recommendation|recommendations|computer vision|ocr|nlp|dataset|datasets|training|prediction|predictions)\b/i,
    observationIds: ["repo.type.ml"],
    dependencies:
      /\b(tensorflow|torch|pytorch|torchvision|transformers|scikit-learn|sklearn|keras|xgboost|lightgbm|sentence-transformers|onnxruntime|langchain|openai|anthropic|@anthropic-ai\/sdk|huggingface|tensorflow\.js)\b/i,
    paths: /\.(ipynb|onnx|pt|pth|h5|pkl|safetensors)$/i,
  },
  {
    id: "tests",
    label: "automated tests",
    claim: /\b(tests?|tested|testing|unit tests?|test coverage|e2e|jest|vitest|cypress|playwright)\b/i,
    covers: /\b(test|tests|tested|testing|coverage|e2e|jest|vitest|cypress|playwright)\b/i,
    observationIds: ["repo.code.tests"],
    paths: /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$/i,
  },
  {
    id: "ci",
    label: "continuous integration",
    claim:
      /\b(ci\/cd|ci|continuous integration|continuous deployment|github actions|pipeline|workflows?)\b/i,
    covers: /\b(ci|cd|continuous integration|continuous deployment|pipeline|pipelines|workflow|workflows)\b/i,
    observationIds: ["repo.code.ci"],
    paths: /(^|\/)(\.github\/workflows\/|\.gitlab-ci\.yml|\.circleci\/|azure-pipelines\.yml|Jenkinsfile)/i,
  },
  {
    id: "database",
    label: "a database / data layer",
    claim:
      /\b(databases?|postgres\w*|mysql|mongo\w*|supabase|firebase|sql|orm|prisma|drizzle|data layer|persistence)\b/i,
    covers:
      /\b(database|databases|postgres|postgresql|mysql|mongo|mongodb|supabase|firebase|sql|orm|prisma|drizzle|persistence)\b/i,
    observationIds: ["repo.code.data"],
    dependencies:
      /\b(pg|postgres|mysql2?|mongoose|mongodb|redis|ioredis|prisma|@prisma\/client|drizzle-orm|supabase|@supabase\/supabase-js|firebase|firebase-admin|sequelize|typeorm|knex)\b/i,
    paths: /(^|\/)(supabase\/migrations\/|migrations?\/|prisma\/)/i,
  },
  {
    id: "api",
    label: "a backend / API",
    claim:
      /\b(apis?|backend|back-end|endpoints?|rest|graphql|server-side|microservices?|routes?)\b/i,
    covers: /\b(api|apis|backend|back-end|endpoint|endpoints|rest|graphql|server-side|microservice|microservices|routes)\b/i,
    observationIds: ["repo.code.api"],
    dependencies:
      /\b(express|fastify|koa|hapi|@nestjs\/core|fastapi|flask|django|uvicorn|gunicorn|rails|graphql|apollo-server)\b/i,
    paths: /(^|\/)(api|server|backend|routes)\/[^/]+\.(ts|tsx|js|jsx|py|go|rb|php)$/i,
  },
  {
    id: "deployment",
    label: "deployment",
    claim:
      /\b(deploy\w*|hosted|hosting|docker|kubernetes|vercel|netlify|cloud|production|container\w*)\b/i,
    covers:
      /\b(deploy|deployed|deployment|deployments|hosted|hosting|docker|kubernetes|vercel|netlify|cloud|production|container|containers)\b/i,
    observationIds: ["repo.code.deployment"],
    paths: /(^|\/)(Dockerfile|docker-compose\.ya?ml|vercel\.json|netlify\.toml|fly\.toml|render\.yaml|Procfile|app\.yaml|k8s\/)/i,
  },
  {
    id: "mobile",
    label: "a mobile app",
    claim: /\b(ios|android|mobile app|mobile apps|react native|flutter|play store|app store)\b/i,
    covers: /\b(ios|android|mobile app|mobile apps|react native|flutter|play store|app store)\b/i,
    observationIds: ["repo.type.mobile"],
    dependencies: /\b(react-native|expo|@capacitor\/core|cordova|@ionic\/react|flutter)\b/i,
    paths: /(^|\/)(android|ios)\/|\.(apk|aab)$/i,
  },
  {
    id: "desktop",
    label: "a desktop app",
    claim: /\b(desktop app|desktop application|electron|tauri)\b/i,
    covers: /\b(desktop app|desktop application|electron|tauri)\b/i,
    observationIds: ["repo.type.desktop"],
    dependencies: /\b(electron|@tauri-apps\/api|@electron-forge\/cli)\b/i,
    paths: /(^|\/)(src-tauri|electron)\//i,
  },
  {
    id: "extension",
    label: "a browser extension",
    claim: /\b(browser extension|chrome extension|extension|extensions|add-?on)\b/i,
    covers: /\b(browser extension|chrome extension|extension|extensions|add-on|addons)\b/i,
    observationIds: ["repo.type.extension"],
    paths: /(^|\/)manifest\.json$/i,
  },
  {
    id: "cli",
    label: "a command-line tool",
    claim: /\b(command line|command-line|cli|terminal tool|shell command)\b/i,
    covers: /\b(command line|command-line|cli|terminal|shell)\b/i,
    observationIds: ["repo.type.cli"],
    paths: /(^|\/)(cli|bin|cmd)\/[^/]+\.(ts|js|py|go|rs)$/i,
  },
  {
    id: "hardware",
    label: "hardware / IoT",
    claim: /\b(arduino|esp32|raspberry pi|firmware|iot|sensor\w*|hardware)\b/i,
    covers: /\b(arduino|esp32|raspberry pi|firmware|iot|sensor|sensors|hardware)\b/i,
    observationIds: ["repo.type.hardware"],
    paths: /(\.ino$|platformio\.ini$|\.kicad_|\.fzz$)/i,
  },
  {
    id: "payments",
    label: "payments",
    claim: /\b(payments?|stripe|paypal|checkout|billing|subscriptions?|razorpay)\b/i,
    covers: /\b(payment|payments|stripe|paypal|checkout|billing|subscription|subscriptions|razorpay)\b/i,
    dependencies: /\b(stripe|@stripe\/[\w-]+|paypal|@paypal\/[\w-]+|razorpay|square)\b/i,
    runtime: /\b(checkout|pay now|buy now|subscribe now|payment)\b/i,
  },
  {
    id: "realtime",
    label: "real-time updates",
    claim: /\b(real[- ]?time|websockets?|socket\.io|live updates?|streaming)\b/i,
    covers: /\b(real-time|realtime|real time|websocket|websockets|socket\.io|streaming|live updates)\b/i,
    dependencies: /\b(socket\.io|^ws$|pusher|ably|supabase-realtime)\b/i,
  },
  {
    id: "storage",
    label: "file upload / storage",
    claim: /\b(uploads?|file storage|cloud storage|attachments?|s3)\b/i,
    covers: /\b(upload|uploads|file storage|cloud storage|attachment|attachments|s3)\b/i,
    dependencies: /\b(multer|aws-sdk|@aws-sdk\/client-s3|cloudinary|formidable|busboy)\b/i,
    paths: /(^|\/)(uploads?|storage|files)\//i,
    runtime: /\b(upload|drop (a|your) file|choose file|browse files)\b/i,
  },
  {
    id: "https",
    label: "HTTPS",
    claim: /\b(https|ssl|tls|encrypted connection|secure connection)\b/i,
    covers: /\b(https|ssl|tls|encrypted connection|secure connection)\b/i,
    observationIds: ["site.accessibility.https"],
    runtime: /\b(https:|secure connection)\b/i,
  },
  {
    id: "performance",
    label: "performance",
    claim: /\b(performance|latency|speed|faster|fast|load times?|response times?)\b/i,
    covers: /\b(performance|latency|speed|faster|fast|load time|load times|response time|response times)\b/i,
    observationIds: ["site.performance.response", "site.performance.assets"],
  },
];
