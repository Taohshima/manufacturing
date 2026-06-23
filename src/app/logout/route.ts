import { cookies } from "next/headers";
import { NextResponse } from "next/server";

// ログアウトは副作用（Cookie削除）を伴うため POST のみ受け付ける。
// GET にすると <Link> のプリフェッチや先読みで意図せずログアウトされてしまう。
export async function POST(req: Request) {
  const store = await cookies();
  store.delete("manufacturing_session");
  // POST からのリダイレクトは 303 にして GET /login へ遷移させる。
  return NextResponse.redirect(new URL("/login", req.url), 303);
}
