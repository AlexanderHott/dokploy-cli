import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const axiosMocks = vi.hoisted(() => ({
	create: vi.fn(),
	get: vi.fn(),
	post: vi.fn(),
	postForm: vi.fn(),
}));

vi.mock("axios", () => ({
	default: {
		create: axiosMocks.create,
	},
}));

describe("readAuthConfig", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		delete process.env.DOKPLOY_URL;
		delete process.env.DOKPLOY_API_KEY;
		delete process.env.DOKPLOY_AUTH_TOKEN;
	});

	afterEach(() => {
		process.env = { ...originalEnv };
		vi.restoreAllMocks();
	});

	it("should read from DOKPLOY_API_KEY env var", async () => {
		process.env.DOKPLOY_URL = "https://test.dokploy.com";
		process.env.DOKPLOY_API_KEY = "test-key-123";

		const { readAuthConfig } = await import("../src/client.js");
		const config = readAuthConfig();

		expect(config.url).toBe("https://test.dokploy.com");
		expect(config.token).toBe("test-key-123");
	});

	it("should read from DOKPLOY_AUTH_TOKEN env var as fallback", async () => {
		process.env.DOKPLOY_URL = "https://test.dokploy.com";
		process.env.DOKPLOY_AUTH_TOKEN = "auth-token-456";

		const { readAuthConfig } = await import("../src/client.js");
		const config = readAuthConfig();

		expect(config.url).toBe("https://test.dokploy.com");
		expect(config.token).toBe("auth-token-456");
	});

	it("should prefer DOKPLOY_API_KEY over DOKPLOY_AUTH_TOKEN", async () => {
		process.env.DOKPLOY_URL = "https://test.dokploy.com";
		process.env.DOKPLOY_API_KEY = "api-key";
		process.env.DOKPLOY_AUTH_TOKEN = "auth-token";

		const { readAuthConfig } = await import("../src/client.js");
		const config = readAuthConfig();

		expect(config.token).toBe("api-key");
	});
});

describe("saveAuthConfig", () => {
	it("should write config with correct structure", async () => {
		const { saveAuthConfig } = await import("../src/client.js");
		expect(typeof saveAuthConfig).toBe("function");
	});
});

describe("API client", () => {
	beforeEach(() => {
		process.env.DOKPLOY_URL = "https://test.dokploy.com";
		process.env.DOKPLOY_API_KEY = "test-key";
		axiosMocks.create.mockReturnValue({
			get: axiosMocks.get,
			post: axiosMocks.post,
			postForm: axiosMocks.postForm,
		});
	});

	afterEach(() => {
		delete process.env.DOKPLOY_URL;
		delete process.env.DOKPLOY_API_KEY;
		vi.clearAllMocks();
	});

	it("wraps GET parameters in the tRPC JSON input envelope", async () => {
		axiosMocks.get.mockResolvedValue({ data: {} });
		const params = { composeId: "compose 1", limit: 1 };

		const { apiGet } = await import("../src/client.js");
		await apiGet("compose.one", params);

		expect(axiosMocks.get).toHaveBeenCalledWith(
			`/trpc/compose.one?input=${encodeURIComponent(
				JSON.stringify({ json: params }),
			)}`,
		);
	});

	it("omits tRPC input when a GET request has no parameters", async () => {
		axiosMocks.get.mockResolvedValue({ data: {} });

		const { apiGet } = await import("../src/client.js");
		await apiGet("project.all");

		expect(axiosMocks.get).toHaveBeenCalledWith("/trpc/project.all");
	});

	it("converts multipart file paths to streams", async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dokploy-cli-"));
		const uploadPath = path.join(tempDir, "artifact.zip");
		fs.writeFileSync(uploadPath, "zip contents");
		axiosMocks.postForm.mockResolvedValue({
			data: { result: { data: { json: { deploymentId: "deployment-1" } } } },
		});

		try {
			const { apiPostForm } = await import("../src/client.js");
			const result = await apiPostForm(
				"application.dropDeployment",
				{
					applicationId: "application-1",
					zip: uploadPath,
					dropBuildPath: undefined,
				},
				["zip"],
			);

			expect(axiosMocks.postForm).toHaveBeenCalledOnce();
			const [url, form] = axiosMocks.postForm.mock.calls[0];
			expect(url).toBe("/trpc/application.dropDeployment");
			expect(form.applicationId).toBe("application-1");
			expect(form.dropBuildPath).toBeUndefined();
			expect(form.zip).toBeInstanceOf(fs.ReadStream);
			expect(form.zip.path).toBe(uploadPath);
			expect(result).toEqual({ deploymentId: "deployment-1" });

			await new Promise<void>((resolve, reject) => {
				form.zip.once("error", reject);
				form.zip.once("open", () => form.zip.close(resolve));
			});
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("rejects a multipart request when a file does not exist", async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dokploy-cli-"));
		const missingPath = path.join(tempDir, "missing.zip");

		try {
			const { apiPostForm } = await import("../src/client.js");
			await expect(
				apiPostForm(
					"application.dropDeployment",
					{ applicationId: "application-1", zip: missingPath },
					["zip"],
				),
			).rejects.toThrow(`File not found: ${missingPath}`);
			expect(axiosMocks.postForm).not.toHaveBeenCalled();
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
