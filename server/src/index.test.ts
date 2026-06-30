import type { D1Migration } from "cloudflare:test";
import { applyD1Migrations } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";

const TEST_MIGRATIONS = (env as unknown as { TEST_MIGRATIONS: D1Migration[] })
	.TEST_MIGRATIONS;
const KID = "test-key";
const USER = (env as unknown as { TEST_USER: string }).TEST_USER;

// Mint a token signed by a key we control, then mock the Access JWKS endpoint to
// publish that key — this exercises the REAL jwtVerify path, no auth bypass.
let token: string;
let mint: (email: string) => Promise<string>;
async function setupAuth() {
	const { publicKey, privateKey } = await generateKeyPair("RS256", {
		extractable: true,
	});
	const jwk = {
		...(await exportJWK(publicKey)),
		kid: KID,
		alg: "RS256",
		use: "sig",
	};
	const certsUrl = `${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;

	// Intercept the Access JWKS fetch jose makes inside the worker; pass everything else through.
	const realFetch = globalThis.fetch;
	vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof Request
					? input.url
					: input.toString();
		if (url === certsUrl)
			return Promise.resolve(Response.json({ keys: [jwk] }));
		return realFetch(input as RequestInfo, init);
	});

	mint = (email: string) =>
		new SignJWT({ email })
			.setProtectedHeader({ alg: "RS256", kid: KID })
			.setIssuer(env.ACCESS_TEAM_DOMAIN)
			.setAudience(env.ACCESS_AUD)
			.setSubject(email)
			.setExpirationTime("1h")
			.sign(privateKey);
	token = await mint(USER);
}

const auth = () => ({ "Cf-Access-Jwt-Assertion": token });

beforeAll(async () => {
	await applyD1Migrations(env.frimmy, TEST_MIGRATIONS);
	await setupAuth();
});

describe("auth", () => {
	it("rejects requests with no Access token", async () => {
		expect((await exports.default.fetch("https://x/auth/me")).status).toBe(401);
	});

	it("rejects a token with a bad signature", async () => {
		const res = await exports.default.fetch("https://x/auth/me", {
			headers: { "Cf-Access-Jwt-Assertion": token.slice(0, -4) + "AAAA" },
		});
		expect(res.status).toBe(401);
	});

	it("rejects a validly-signed token for a non-allowlisted email", async () => {
		const res = await exports.default.fetch("https://x/auth/me", {
			headers: { "Cf-Access-Jwt-Assertion": await mint("nope@evil.com") },
		});
		expect(res.status).toBe(403);
	});

	it("GET /auth/me returns the verified identity", async () => {
		const res = await exports.default.fetch("https://x/auth/me", {
			headers: auth(),
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ id: USER, email: USER });
	});
});

describe("edits CRUD", () => {
	it("create -> get -> list -> update -> delete", async () => {
		const create = await exports.default.fetch("https://x/edits", {
			method: "POST",
			headers: auth(),
			body: JSON.stringify({
				diff: "body{color:red}",
				target_url: "https://a.com",
				title: "t",
			}),
		});
		expect(create.status).toBe(201);
		const { id } = await create.json<{ id: string }>();

		const get = await exports.default.fetch(`https://x/edits/${id}`, {
			headers: auth(),
		});
		expect(await get.json()).toMatchObject({
			id,
			diff: "body{color:red}",
			title: "t",
		});

		const list = await exports.default.fetch("https://x/edits", {
			headers: auth(),
		});
		expect((await list.json<unknown[]>()).length).toBe(1);

		const put = await exports.default.fetch(`https://x/edits/${id}`, {
			method: "PUT",
			headers: auth(),
			body: JSON.stringify({ diff: "body{color:blue}" }),
		});
		expect(put.status).toBe(200);
		expect(
			await (
				await exports.default.fetch(`https://x/edits/${id}`, {
					headers: auth(),
				})
			).json(),
		).toMatchObject({
			diff: "body{color:blue}",
		});

		const del = await exports.default.fetch(`https://x/edits/${id}`, {
			method: "DELETE",
			headers: auth(),
		});
		expect(del.status).toBe(204);
		expect(
			(
				await exports.default.fetch(`https://x/edits/${id}`, {
					headers: auth(),
				})
			).status,
		).toBe(404);
	});

	it("rejects create without required fields", async () => {
		const res = await exports.default.fetch("https://x/edits", {
			method: "POST",
			headers: auth(),
			body: "{}",
		});
		expect(res.status).toBe(400);
	});
});
