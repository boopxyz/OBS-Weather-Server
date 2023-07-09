const { client, xml, jid } = require("@xmpp/client");
const debug = require("@xmpp/debug");

const xmpp = client({
  service: "xmpps://140.90.59.197:5223",
  domain: "nwws-oi.weather.gov",
  resource: "nwws",
  username: "wind.096",
  password: "Mxq#cD&",
});

debug(xmpp, true);

xmpp.on("error", (err) => {
  console.error(err);
});

xmpp.on("offline", () => {
  console.log("offline");
});

xmpp.on("stanza", async (stanza) => {
  if (stanza.is("message")) {
    await xmpp.send(xml("presence", { type: "unavailable" }));
    await xmpp.stop();
  }
});

xmpp.on("online", async (address) => {
  // Makes itself available
  await xmpp.send(xml("presence"));

  // Sends a chat message to itself
  const message = xml(
    "message",
    { type: "chat", to: address },
    xml("body", {}, "hello world")
  );
  await xmpp.send(message);
});

xmpp.start().catch(console.error);

/*
xmpp.connect({
  jid: "wind.096@nwws-oi.weather.gov",
  password: "Mxq#cD&",
  host: "ws://conference.nwws-oi.weather.gov",
  port: 5223,
});
*/
