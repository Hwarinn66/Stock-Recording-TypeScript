import { randomBytes, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { rows, execute, transaction } from "./db";
import { AppError } from "./errors";
export const cookieName = "warehouse_session";
// Penanda perangkat yang pernah login sukses. Perangkat ini memakai kuota percobaan
// sendiri, sehingga percobaan gagal dari perangkat lain tidak dapat menguncinya.
const deviceCookie = "warehouse_device";
const trustedDays = 90;
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function session(token?: string) {
  const value = token ?? (await cookies()).get(cookieName)?.value;
  if (!value) return null;
  return (
    (
      await rows<{ id: number; username: string }>(
        "SELECT u.id,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP(3)",
        [hash(value)],
      )
    )[0] ?? null
  );
}
export async function requireUser() {
  const user = await session();
  if (!user) throw new AppError("UNAUTHORIZED", "Silakan login dahulu.", 401);
  return user;
}
export function checkOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const allowed = [
    process.env.APP_URL,
    ...(process.env.ALLOWED_ORIGINS || "").split(","),
  ]
    .map((value) => value?.trim())
    .filter(Boolean);
  // Browser writes require an explicitly configured origin. Hardware clients may omit Origin and use a valid session cookie.
  if (origin && !allowed.includes(origin))
    throw new AppError(
      "INVALID_ORIGIN",
      "Origin belum diizinkan. Periksa ALLOWED_ORIGINS.",
      403,
    );
  if (req.headers.get("sec-fetch-site") === "cross-site")
    throw new AppError(
      "INVALID_ORIGIN",
      "Permintaan lintas situs ditolak.",
      403,
    );
}
async function attemptKey(name: string, device: string | undefined) {
  if (device) {
    const key = hash(`device:${name}:${device}`);
    const [known] = await rows(
      "SELECT identity_hash FROM login_attempts WHERE identity_hash=? AND window_start>TIMESTAMPADD(DAY,?,UTC_TIMESTAMP(3))",
      [key, -trustedDays],
    );
    if (known) return { key, trusted: true };
  }
  return { key: hash(name), trusted: false };
}
export async function login(username: string, password: string) {
  const name = username.toLowerCase();
  const jar = await cookies();
  const cookieDevice = jar.get(deviceCookie)?.value;
  const device =
    cookieDevice && /^[0-9a-f]{64}$/.test(cookieDevice)
      ? cookieDevice
      : undefined;
  const { key, trusted } = await attemptKey(name, device);
  await transaction(async (conn) => {
    await execute(
      "INSERT IGNORE INTO login_attempts(identity_hash) VALUES (?)",
      [key],
      conn,
    );
    const [rate] = await rows<{ attempts: number; age: number }>(
      "SELECT attempts,TIMESTAMPDIFF(SECOND,window_start,UTC_TIMESTAMP()) age FROM login_attempts WHERE identity_hash=? FOR UPDATE",
      [key],
      conn,
    );
    if (rate.age >= 900)
      await execute(
        "UPDATE login_attempts SET attempts=1,window_start=UTC_TIMESTAMP(3) WHERE identity_hash=?",
        [key],
        conn,
      );
    else {
      if (rate.attempts >= 10)
        throw new AppError(
          "RATE_LIMIT",
          "Terlalu banyak percobaan. Coba lagi setelah 15 menit.",
          429,
        );
      await execute(
        "UPDATE login_attempts SET attempts=attempts+1 WHERE identity_hash=?",
        [key],
        conn,
      );
    }
  });
  const [user] = await rows<{ id: number; password_hash: string }>(
    "SELECT id,password_hash FROM users WHERE username=?",
    [username],
  );
  const valid = await bcrypt.compare(
    password,
    user?.password_hash ??
      "$2b$12$C6UzMDM.H6dfI/f/IKcEe.7NXFdtUm17mDAeSBt.FWjR0VvS4u1yK",
  );
  if (!user || !valid)
    throw new AppError("INVALID_LOGIN", "Username atau password salah.", 401);
  const token = randomBytes(32).toString("hex");
  const hours = Math.min(
    72,
    Math.max(1, Number(process.env.SESSION_HOURS) || 12),
  );
  await execute(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,TIMESTAMPADD(HOUR,?,UTC_TIMESTAMP(3)))",
    [hash(token), user.id, hours],
  );
  // Kuota bersama per username tetap terkunci bila login sukses dari perangkat tepercaya.
  if (!trusted)
    await execute("DELETE FROM login_attempts WHERE identity_hash=?", [key]);
  const deviceToken = device ?? randomBytes(32).toString("hex");
  await execute(
    "INSERT INTO login_attempts(identity_hash,attempts,window_start) VALUES (?,0,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE attempts=0,window_start=UTC_TIMESTAMP(3)",
    [hash(`device:${name}:${deviceToken}`)],
  );
  await execute(
    "DELETE FROM login_attempts WHERE window_start<TIMESTAMPADD(DAY,?,UTC_TIMESTAMP(3))",
    [-trustedDays],
  );
  await execute("DELETE FROM sessions WHERE expires_at<UTC_TIMESTAMP(3)");
  const secure = process.env.COOKIE_SECURE === "true";
  // Cookie session dipasang lebih dulu; klien sederhana membaca Set-Cookie pertama.
  jar.set(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: hours * 3600,
  });
  jar.set(deviceCookie, deviceToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: trustedDays * 86400,
  });
}
export async function logout() {
  const jar = await cookies();
  const token = jar.get(cookieName)?.value;
  if (token)
    await execute("DELETE FROM sessions WHERE token_hash=?", [hash(token)]);
  jar.delete(cookieName);
}
