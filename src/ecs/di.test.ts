import { describe, expect, it } from "vite-plus/test";
import { createScope, instanceProvider, resolve, type Key } from "./di.ts";

describe("scoped DI", () => {
	it("resolves typed instance providers while constructing", () => {
		const Logger = Symbol("Logger") as Key<{ messages: string[] }>;
		const logger = { messages: [] };
		const scope = createScope([instanceProvider(Logger, logger)]);

		class Service {
			readonly dependency = resolve(Logger);
		}

		const service = scope.construct(Service);
		service.dependency.messages.push("constructed");
		expect(logger.messages).toEqual(["constructed"]);
		scope.dispose();
	});

	it("keeps scopes isolated and rejects resolution outside construction", () => {
		const Token = Symbol("Token");
		const first = createScope([instanceProvider(Token, "first")]);
		const second = createScope([instanceProvider(Token, "second")]);
		class Reader {
			readonly value = resolve(Token);
		}

		expect(first.construct(Reader).value).toBe("first");
		expect(second.construct(Reader).value).toBe("second");
		expect(() => resolve(Token)).toThrow(/outside a managed construction context/);
		first.dispose();
		second.dispose();
	});

	it("rejects use after scope disposal", () => {
		const Token = Symbol("Token");
		const scope = createScope([instanceProvider(Token, 1)]);
		scope.dispose();

		expect(() => scope.resolve(Token)).toThrow(/disposed service scope/);
		expect(() => scope.construct(class Service {})).toThrow(/disposed service scope/);
	});
});
