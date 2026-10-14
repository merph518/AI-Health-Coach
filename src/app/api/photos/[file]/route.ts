import { currentUser } from "@/lib/auth";
import { readPhoto } from "@/lib/coach/thread";

const TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

// Serves the signed-in user's own chat photos only (they live under data/uploads/<user id>/).
export async function GET(_: Request, ctx: RouteContext<"/api/photos/[file]">) {
  const user = await currentUser();
  if (!user) return new Response(null, { status: 401 });
  const { file } = await ctx.params;
  const bytes = readPhoto(user.id, file);
  if (!bytes) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": TYPES[file.split(".").pop()!], "cache-control": "private, max-age=31536000, immutable" },
  });
}
