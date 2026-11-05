// Konten für TrueScope.
//   GET  /api/auth/me                        → { enabled, user: {firstName, lastName, email} | null }
//   GET  /api/auth/verify?token=…            → bestätigt die E-Mail-Adresse, meldet an, leitet zur Startseite
//   POST /api/auth/register {firstName, lastName, email, password, consent}
//   POST /api/auth/login    {email, password}
//   POST /api/auth/logout
//   POST /api/auth/forgot   {email}           → Link zum Zurücksetzen per E-Mail
//   POST /api/auth/reset    {token, password} → neues Passwort, meldet an
//   POST /api/auth/delete   {password}        → Konto endgültig löschen
//
// Ein Konto entsteht erst, wenn die E-Mail-Adresse bestätigt ist. Bis dahin liegt die Anmeldung nur als
// Einmal-Link (mit Name und Passwort-Hash) in auth_tokens und verfällt nach 48 Stunden.

import {
  json, fail, normEmail, validEmail, cleanName, passwordProblem, hashPassword, checkPassword,
  createSession, clearCookie, currentUser, endSession, useToken, randomToken, sha256,
  allow, ipOf, sameOrigin, emailReady, sendMail, mailBody,
} from "../../../lib/auth.js";

const HOUR = 36e5;
const readBody = async (request) => { try { return await request.json(); } catch { return {}; } };
const publicUser = (u) => u && { firstName: u.first_name, lastName: u.last_name, email: u.email };
const SENT = "Wenn die Angaben stimmen, ist eine E-Mail unterwegs. Schau in dein Postfach (auch in den Spam-Ordner).";

// ---------- GET ----------

export async function onRequestGet({ request, env, params }) {
  const url = new URL(request.url);
  if (params.action === "me") {
    const u = await currentUser(env, request);
    return json({ enabled: emailReady(env), user: u ? publicUser(u) : null });
  }
  if (params.action === "verify") {
    const to = (q, cookie) => new Response(null, { status: 302, headers: { Location: "/?konto=" + q, ...(cookie ? { "Set-Cookie": cookie } : {}) } });
    const token = url.searchParams.get("token") || "";
    if (!token || token.length > 100) return to("link-ungueltig");
    const h = await sha256(token);
    const row = await env.DB.prepare("SELECT data, expires_at FROM auth_tokens WHERE token_hash = ? AND kind = 'verify'").bind(h).first();
    if (!row) return to("link-ungueltig");
    await env.DB.prepare("DELETE FROM auth_tokens WHERE token_hash = ?").bind(h).run();
    if (row.expires_at < Date.now()) return to("link-abgelaufen");
    let d; try { d = JSON.parse(row.data); } catch { return to("link-ungueltig"); }
    const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(d.email).first();
    if (existing) return to("schon-bestaetigt"); // Konto gibt es schon – Passwort bleibt unverändert
    const id = randomToken(12), now = Date.now();
    await env.DB.prepare(
      "INSERT INTO users (id, email, first_name, last_name, pw_hash, pw_salt, pw_iter, created_at, consent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, d.email, d.firstName, d.lastName, d.hash, d.salt, d.iter, now, d.consentAt).run();
    await env.DB.prepare("DELETE FROM auth_tokens WHERE kind = 'verify' AND email = ?").bind(d.email).run();
    return to("bestaetigt", await createSession(env, id));
  }
  return fail("Unbekannte Aktion.", 404);
}

// ---------- POST ----------

export async function onRequestPost(context) {
  const { request, env, params } = context;
  if (!sameOrigin(request)) return fail("Anfrage abgelehnt.", 403);
  const b = await readBody(request);
  const ip = ipOf(request);
  const origin = new URL(request.url).origin;

  switch (params.action) {
    case "register": {
      if (!emailReady(env)) return fail("Die Anmeldung ist noch nicht eingerichtet. Du kannst TrueScope aber ohne Konto nutzen.", 503);
      const email = normEmail(b.email), firstName = cleanName(b.firstName), lastName = cleanName(b.lastName);
      if (!firstName || !lastName) return fail("Bitte gib Vor- und Nachnamen an.");
      if (!validEmail(email)) return fail("Bitte gib eine gültige E-Mail-Adresse an.");
      const pwErr = passwordProblem(b.password); if (pwErr) return fail(pwErr);
      if (b.consent !== true) return fail("Bitte akzeptiere die Cookies und die Datenschutzerklärung.");
      if (!(await allow(env, "reg-ip:" + ip, 6, HOUR)) || !(await allow(env, "reg-mail:" + email, 3, HOUR)))
        return fail("Zu viele Versuche. Bitte versuche es in einer Stunde noch einmal.", 429);

      const existing = await env.DB.prepare("SELECT first_name FROM users WHERE email = ?").bind(email).first();
      try {
        if (existing) {
          // Kein Hinweis in der Antwort, ob die Adresse registriert ist – stattdessen eine E-Mail an die Adresse.
          await sendMail(env, email, "Du hast schon ein TrueScope-Konto", mailBody({
            hello: `Hallo ${existing.first_name},`,
            intro: "jemand (vermutlich du) wollte sich gerade mit dieser E-Mail-Adresse bei TrueScope registrieren. Du hast aber schon ein Konto. Melde dich einfach an – oder setze dein Passwort zurück, falls du es vergessen hast.",
            button: "Zu TrueScope", link: origin + "/?konto=anmelden",
            outro: "Warst du das nicht? Dann kannst du diese E-Mail ignorieren.",
          }));
        } else {
          const pw = await hashPassword(b.password);
          const token = randomToken(32), now = Date.now();
          const data = JSON.stringify({ email, firstName, lastName, hash: pw.hash, salt: pw.salt, iter: pw.iter, consentAt: now });
          await env.DB.batch([
            env.DB.prepare("DELETE FROM auth_tokens WHERE kind = 'verify' AND email = ?").bind(email), // nur der neueste Link gilt
            env.DB.prepare("INSERT INTO auth_tokens (token_hash, user_id, kind, expires_at, email, data) VALUES (?, NULL, 'verify', ?, ?, ?)")
              .bind(await sha256(token), now + 48 * HOUR, email, data),
          ]);
          await sendMail(env, email, "Bitte bestätige deine E-Mail-Adresse", mailBody({
            hello: `Hallo ${firstName},`,
            intro: "willkommen bei TrueScope! Bitte bestätige deine E-Mail-Adresse, damit dein Konto aktiv wird.",
            button: "E-Mail-Adresse bestätigen", link: `${origin}/api/auth/verify?token=${token}`,
            outro: "Der Link ist 48 Stunden gültig. Hast du dich nicht registriert? Dann ignoriere diese E-Mail – es wird kein Konto angelegt.",
          }));
        }
      } catch (e) {
        console.log("register mail", String(e));
        return fail("Die E-Mail konnte gerade nicht verschickt werden. Bitte versuche es später noch einmal.", 502);
      }
      return json({ ok: true, message: "Fast geschafft! Wir haben dir eine E-Mail geschickt. Klicke auf den Link darin, um dein Konto zu bestätigen." });
    }

    case "login": {
      const email = normEmail(b.email);
      if (!validEmail(email) || !b.password) return fail("Bitte gib E-Mail-Adresse und Passwort an.");
      if (!(await allow(env, "login-ip:" + ip, 20, HOUR / 4)) || !(await allow(env, "login-mail:" + email, 8, HOUR / 4)))
        return fail("Zu viele Versuche. Bitte warte eine Viertelstunde.", 429);
      const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
      if (!(await checkPassword(b.password, user))) {
        if (!user) {
          const pending = await env.DB.prepare("SELECT 1 FROM auth_tokens WHERE kind = 'verify' AND email = ? AND expires_at > ?").bind(email, Date.now()).first();
          if (pending) return fail("Bitte bestätige zuerst deine E-Mail-Adresse. Den Link dazu haben wir dir per E-Mail geschickt.", 403, { code: "unverified" });
        }
        return fail("E-Mail-Adresse oder Passwort stimmen nicht.", 401);
      }
      return json({ ok: true, user: publicUser(user) }, 200, { "Set-Cookie": await createSession(env, user.id) });
    }

    case "logout": {
      await endSession(env, request);
      return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
    }

    case "forgot": {
      if (!emailReady(env)) return fail("Das Zurücksetzen per E-Mail ist noch nicht eingerichtet.", 503);
      const email = normEmail(b.email);
      if (!validEmail(email)) return fail("Bitte gib eine gültige E-Mail-Adresse an.");
      if (!(await allow(env, "forgot-ip:" + ip, 6, HOUR)) || !(await allow(env, "forgot-mail:" + email, 3, HOUR)))
        return fail("Zu viele Versuche. Bitte versuche es in einer Stunde noch einmal.", 429);
      const user = await env.DB.prepare("SELECT id, first_name FROM users WHERE email = ?").bind(email).first();
      if (user) {
        const token = randomToken(32);
        await env.DB.batch([
          env.DB.prepare("DELETE FROM auth_tokens WHERE kind = 'reset' AND user_id = ?").bind(user.id),
          env.DB.prepare("INSERT INTO auth_tokens (token_hash, user_id, kind, expires_at, email) VALUES (?, ?, 'reset', ?, ?)")
            .bind(await sha256(token), user.id, Date.now() + HOUR, email),
        ]);
        try {
          await sendMail(env, email, "Passwort zurücksetzen", mailBody({
            hello: `Hallo ${user.first_name},`,
            intro: "du kannst jetzt ein neues Passwort für dein TrueScope-Konto festlegen.",
            button: "Neues Passwort festlegen", link: `${origin}/?reset=${token}`,
            outro: "Der Link ist eine Stunde gültig und funktioniert nur einmal. Hast du das nicht angefordert? Dann ignoriere diese E-Mail – dein Passwort bleibt unverändert.",
          }));
        } catch (e) { console.log("forgot mail", String(e)); }
      }
      return json({ ok: true, message: SENT });
    }

    case "reset": {
      const pwErr = passwordProblem(b.password); if (pwErr) return fail(pwErr);
      if (!(await allow(env, "reset-ip:" + ip, 10, HOUR))) return fail("Zu viele Versuche. Bitte versuche es später noch einmal.", 429);
      const userId = await useToken(env, String(b.token || ""), "reset");
      if (!userId) return fail("Der Link ist ungültig oder abgelaufen. Fordere bitte einen neuen an.", 400, { code: "badtoken" });
      const pw = await hashPassword(b.password);
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iter = ? WHERE id = ?").bind(pw.hash, pw.salt, pw.iter, userId),
        env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId), // überall abmelden
      ]);
      const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first();
      return json({ ok: true, user: publicUser(user) }, 200, { "Set-Cookie": await createSession(env, userId) });
    }

    case "delete": {
      const u = await currentUser(env, request);
      if (!u) return fail("Du bist nicht angemeldet.", 401);
      if (!(await allow(env, "delete-ip:" + ip, 10, HOUR))) return fail("Zu viele Versuche.", 429);
      const full = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(u.id).first();
      if (!(await checkPassword(b.password, full))) return fail("Das Passwort stimmt nicht.", 401);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(u.id),
        env.DB.prepare("DELETE FROM auth_tokens WHERE user_id = ? OR email = ?").bind(u.id, u.email),
        env.DB.prepare("DELETE FROM users WHERE id = ?").bind(u.id),
      ]);
      return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
    }
  }
  return fail("Unbekannte Aktion.", 404);
}
