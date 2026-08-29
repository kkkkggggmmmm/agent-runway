import readline from "node:readline";

const reader = readline.createInterface({ input: process.stdin });
let reads = 0;

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
  }
});
