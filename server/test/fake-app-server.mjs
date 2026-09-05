import readline from "node:readline";

const reader = readline.createInterface({ input: process.stdin });
let reads = 0;
let loggedIn = false;

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

reader.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ id: message.id, result: { serverInfo: { name: "fake-codex", version: "1.0.0" } } });
    return;
  }

  if (message.method === "account/rateLimits/read") {
    reads += 1;
    send({
      id: message.id,
      result: {
        rateLimits: {
          limitId: "codex",
          planType: "pro",
          primary: { usedPercent: 40 + reads, windowDurationMins: 10_080, resetsAt: 2_000_000_000 },
        },
      },
    });
    if (reads === 1) setTimeout(() => send({ method: "account/rateLimits/updated", params: {} }), 100);
    return;
  }

  if (message.method === "account/read") {
    send({
      id: message.id,
      result: {
        account: loggedIn ? { type: "chatgpt", email: "do-not-retain@example.test", planType: "pro" } : null,
        requiresOpenaiAuth: true,
      },
    });
    return;
  }

  if (message.method === "account/login/start") {
    if (
      message.params?.type !== "chatgpt"
      || message.params?.useHostedLoginSuccessPage !== true
      || message.params?.appBrand !== "chatgpt"
    ) {
      send({ id: message.id, error: { message: "expected hosted ChatGPT login parameters" } });
      return;
    }
    send({
      id: message.id,
      result: {
        type: "chatgpt",
        loginId: "fake-login",
        authUrl: "https://auth.openai.com/authorize?fake=1",
      },
    });
    setTimeout(() => {
      loggedIn = true;
      send({ method: "account/login/completed", params: { loginId: "fake-login", success: true, error: null } });
      send({ method: "account/updated", params: { authMode: "chatgpt", planType: "pro" } });
    }, 50);
  }
});
