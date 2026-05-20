import { hash } from "bcryptjs";

async function main() {
  const password = process.argv[2];
  if (!password) {
    console.error("Usage: npm run auth:hash -- <password>");
    process.exit(1);
  }
  const result = await hash(password, 12);
  console.log(result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
