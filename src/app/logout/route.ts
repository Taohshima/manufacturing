import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const store = await cookies();
  store.delete("manufacturing_session");
  return NextResponse.redirect(new URL("/login", req.url));
}
