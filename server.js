const OBSWebSocket = require("obs-websocket-js").default;
const axios = require("axios");
const fs = require("fs");
require("dotenv").config();

const alertApiUrl =
  "https://api.weather.gov/alerts/active?status=actual&code[0]=SVR&code[1]=TOR";

const obs = new OBSWebSocket();
let isConnected = false;

let activeAlerts = [];
/*
    {
        "id": "https://api.weather.gov/alerts/NOAA-NWS-ALY-1252e1a2e5e4e8e8e8e8e8e8e8e8e8e8",
        "areaDesc": "Northwest Alabama",
        "certainty": "Likely",
        "event": "Tornado Warning",
        "displayName": "Tornado Warning for Northwest Alabama (Likely)",
        "isShown": false
    }
*/
let alertQueue = [];
let isQueing = false;
let isHandling = false;
let activeNumber = 0;

async function Connect() {
  try {
    await obs.connect(
      `ws://${process.env.SOCKET_IP}:${process.env.SOCKET_PORT}`,
      process.env.SOCKET_PASSWORD
    );
    isConnected = true;
    console.log("Connected to OBS WebSocket Server");
  } catch (e) {
    console.error(`Failed to Connect to the OBS WebSocket Server. Error: ${e}`);
  }
}

function ResetDataFiles() {
  fs.writeFile("./data/WarnCount.txt", `WARN COUNT: 0`, (err) => {
    if (err) {
      console.error(err);
    }
  });
  fs.writeFile("./data/ActiveAlertText.txt", ``, (err) => {
    if (err) {
      console.error(err);
    }
  });
  fs.writeFile("./data/ActiveAlertTitle.txt", ``, (err) => {
    if (err) {
      console.error(err);
    }
  });
}

function WriteWarnCount() {
  fs.writeFile(
    "./data/WarnCount.txt",
    `WARN COUNT: ${activeAlerts.length}`,
    (err) => {
      if (err) {
        console.error(err);
      }
    }
  );
}

async function HandleQueue() {
  console.log("handling queue");
  isQueing = true;

  if (isConnected && alertQueue.length > 0) {
    console.log("Pass #1");
    console.log(activeAlerts);
    activeAlert = activeAlerts.find((a) => a.id === alertQueue[0]);
    if (activeAlert && !activeAlert.isShown) {
      console.log("Pass #2");
      const { currentProgramSceneName } = await obs.call(
        "GetCurrentProgramScene"
      );
      const { sceneItemId } = await obs.call("GetSceneItemId", {
        sceneName: currentProgramSceneName,
        sourceName: "Alert",
      });

      fs.writeFile(
        "./data/AlertName.txt",
        `${activeAlert.event} (${activeAlert.certainty})`,
        (err) => {
          if (err) {
            console.error(err);
          }
        }
      );
      fs.writeFile("./data/AlertDesc.txt", activeAlert.areaDesc, (err) => {
        if (err) {
          console.error(err);
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 2000));

      await obs.call("SetSceneItemEnabled", {
        sceneName: currentProgramSceneName,
        sceneItemId: sceneItemId,
        sceneItemEnabled: true,
      });
      console.log("Pass #3");
      await new Promise((resolve) => setTimeout(resolve, 10000));
      await obs.call("SetSceneItemEnabled", {
        sceneName: currentProgramSceneName,
        sceneItemId: sceneItemId,
        sceneItemEnabled: false,
      });

      activeAlert.isShown = true;
    }

    alertQueue.shift();
  }

  if (alertQueue.length > 0) {
    console.log("Pass #4");
    HandleQueue();
  } else {
    isQueing = false;
  }
}

function ApiSuccess(res) {
  isHandling = true;
  const alerts = res.data.features;
  newAlerts = [];
  alerts.forEach((alert) => {
    console.log(alert);

    const existingActive = activeAlerts.find((a) => a.id === alert.id);
    if (existingActive) {
      newAlerts.push(existingActive);
    } else {
      newAlerts.push({
        id: alert.id,
        areaDesc: alert.properties.areaDesc,
        certainty: alert.properties.certainty,
        event: alert.properties.event,
        displayName: `${alert.properties.event} for ${alert.properties.areaDesc} (${alert.properties.certainty})`,
        isShown: false,
      });

      alertQueue.push(alert.id);
    }
  });

  activeAlerts = newAlerts;
  if (process.env.WARN_COUNT_ENABLED == "true") {
    WriteWarnCount();
  }

  if (!isQueing) {
    HandleQueue();
  }

  isHandling = false;
}

function Loop() {
  if (!isHandling) {
    axios
      .get(alertApiUrl)
      .then((res) => {
        console.log("Request Successful");
        ApiSuccess(res);
      })
      .catch((err) => {
        console.log(err);
      });
  }
}

function AlertListLoop() {
  if (activeAlerts.length > 0) {
    activeNumber += 1;
    if (activeNumber > activeAlerts.length - 1) {
      activeNumber = 0;
    }

    fs.writeFile(
      "./data/ActiveAlertTitle.txt",
      `${activeAlerts[activeNumber].event}`,
      (err) => {
        if (err) {
          console.error(err);
        }
      }
    );
    fs.writeFile(
      "./data/ActiveAlertText.txt",
      `${activeAlerts[activeNumber].areaDesc}`,
      (err) => {
        if (err) {
          console.error(err);
        }
      }
    );
  } else {
    fs.writeFile("./data/ActiveAlertText.txt", ``, (err) => {
      if (err) {
        console.error(err);
      }
    });
    fs.writeFile("./data/ActiveAlertTitle.txt", ``, (err) => {
      if (err) {
        console.error(err);
      }
    });
  }
}

ResetDataFiles();
Connect();
//Loop();
if (
  process.env.ALERT_ENABLED == "true" ||
  process.env.WARN_COUNT_ENABLED == "true"
) {
  setInterval(Loop, 5000);
}

if (process.env.ALERT_LIST_ENABLED == "true") {
  setInterval(AlertListLoop, 8000);
}
