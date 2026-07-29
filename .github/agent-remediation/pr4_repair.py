from pathlib import Path


def ensure_replace(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"pattern not found in {path}: {old[:160]!r}")
    p.write_text(text.replace(old, new, 1))

limits = "artifacts/api-server/src/lib/upload-limits.ts"
ensure_replace(
    limits,
    "export const DEFAULT_MULTER_FILE_BYTES = 25 * 1024 * 1024; // 25 MB\n",
    "export const DEFAULT_MULTER_FILE_BYTES = 25 * 1024 * 1024; // 25 MB\n\n/** Image-only buckets mirror the standard inbound upload ceiling. */\nexport const STANDARD_IMAGE_BUCKET_FILE_BYTES = DEFAULT_MULTER_FILE_BYTES;\n",
)

storage = "artifacts/api-server/src/lib/storage-core.ts"
ensure_replace(
    storage,
    'import { SUPABASE_BUCKET_FILE_BYTES } from "./upload-limits";',
    'import {\n  STANDARD_IMAGE_BUCKET_FILE_BYTES,\n  SUPABASE_BUCKET_FILE_BYTES,\n} from "./upload-limits";',
)
ensure_replace(
    storage,
    '''export const IMAGE_ONLY_POLICY: BucketPolicy = {\n  // Capped at SUPABASE_BUCKET_FILE_BYTES (50 MB) — Supabase enforces a\n  // plan-level ceiling on the bucket fileSizeLimit parameter.  Express/multer\n  // enforces its own (larger) 100 MB cap independently.\n  fileSizeLimit: SUPABASE_BUCKET_FILE_BYTES,\n''',
    '''export const IMAGE_ONLY_POLICY: BucketPolicy = {\n  // Image-only buckets match the standard 25 MB inbound ceiling. The image\n  // pipeline normalizes accepted images before persistence, so storage never\n  // needs a broader limit than the request path that feeds it.\n  fileSizeLimit: STANDARD_IMAGE_BUCKET_FILE_BYTES,\n''',
)

upload_test = "artifacts/api-server/src/middleware/uploadSizeGuard.test.ts"
ensure_replace(
    upload_test,
    '''  ELAINE_ATTACHMENT_FILE_BYTES,\n  SUPABASE_BUCKET_FILE_BYTES,\n''',
    '''  ELAINE_ATTACHMENT_FILE_BYTES,\n  STANDARD_IMAGE_BUCKET_FILE_BYTES,\n  SUPABASE_BUCKET_FILE_BYTES,\n''',
)
ensure_replace(
    upload_test,
    '''  it("exports DEFAULT_UPLOAD_BYTES = 101 MB and HIGH_UPLOAD_BYTES = 101 MB", () => {\n    expect(DEFAULT_UPLOAD_BYTES).toBe(101 * 1024 * 1024);\n    expect(HIGH_UPLOAD_BYTES).toBe(101 * 1024 * 1024);\n  });\n\n  it("exports DEFAULT_MULTER_FILE_BYTES = 100 MB and HIGH_MULTER_FILE_BYTES = 100 MB", () => {\n    expect(DEFAULT_MULTER_FILE_BYTES).toBe(100 * 1024 * 1024);\n    expect(HIGH_MULTER_FILE_BYTES).toBe(100 * 1024 * 1024);\n  });\n''',
    '''  it("exports 26 MB and 51 MB route-aware guard ceilings", () => {\n    expect(DEFAULT_UPLOAD_BYTES).toBe(26 * 1024 * 1024);\n    expect(HIGH_UPLOAD_BYTES).toBe(51 * 1024 * 1024);\n  });\n\n  it("exports 25 MB standard and 50 MB high-cap multer ceilings", () => {\n    expect(DEFAULT_MULTER_FILE_BYTES).toBe(25 * 1024 * 1024);\n    expect(HIGH_MULTER_FILE_BYTES).toBe(50 * 1024 * 1024);\n  });\n''',
)
ensure_replace(
    upload_test,
    '''  it("SUPABASE_BUCKET_FILE_BYTES (50 MB) is within the default Express guard", () => {\n    expect(SUPABASE_BUCKET_FILE_BYTES).toBeLessThanOrEqual(\n      DEFAULT_MULTER_FILE_BYTES,\n    );\n    expect(SUPABASE_BUCKET_FILE_BYTES).toBeLessThanOrEqual(\n      DEFAULT_UPLOAD_BYTES,\n    );\n  });\n''',
    '''  it("the image-only bucket limit is within the default Express guard", () => {\n    expect(STANDARD_IMAGE_BUCKET_FILE_BYTES).toBeLessThanOrEqual(\n      DEFAULT_MULTER_FILE_BYTES,\n    );\n    expect(STANDARD_IMAGE_BUCKET_FILE_BYTES).toBeLessThanOrEqual(\n      DEFAULT_UPLOAD_BYTES,\n    );\n  });\n''',
)

quality = "artifacts/api-server/src/lib/review-remediation-quality.test.ts"
ensure_replace(
    quality,
    'source("../../../../../lib/upload-validation/src/index.ts")',
    'source("../../../../lib/upload-validation/src/index.ts")',
)
ensure_replace(
    quality,
    'source("../../routes/agentphone.ts")',
    'source("../routes/agentphone.ts")',
)
ensure_replace(
    quality,
    'source("../../routes/elaine-email.ts")',
    'source("../routes/elaine-email.ts")',
)
ensure_replace(
    quality,
    'source("../../routes/messenger/conversations.ts")',
    'source("../routes/messenger/conversations.ts")',
)

email_test = "artifacts/api-server/src/routes/elaine-email.test.ts"
ensure_replace(
    email_test,
    '''function makeUpdateBuilder() {\n  const builder: Record<string, () => unknown> = {\n    set() {\n      return builder;\n    },\n    where() {\n      return Promise.resolve([]);\n    },\n  };\n  return builder;\n}\n''',
    '''function makeUpdateBuilder() {\n  const builder: Record<string, () => unknown> = {\n    set() {\n      return builder;\n    },\n    where() {\n      return builder;\n    },\n    returning() {\n      return Promise.resolve([{ id: 1 }]);\n    },\n  };\n  return builder;\n}\n''',
)
