const OBSWebSocket = require("obs-websocket-js").default;
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const boxen = require("boxen");
const mustache = require("mustache");

process.on("uncaughtException", function (err) {
  console.error(err);
  console.log("Node NOT Exiting...");
});

var util = require("util");
var log_stdout = process.stdout;

console.log = function (d) {
  fs.appendFile("./debug.log", util.format(d) + "\n", (err) => {
    if (err) {
      console.error(err);
    }
  });
  log_stdout.write(util.format(d) + "\n");
};

const config = JSON.parse(
  fs.readFileSync(path.join(path.dirname(process.execPath), "config.json"))
);

//const config = require("./config.json");

const alertApiUrl = "https://api.weather.gov/alerts/active"; //?status=actual&code[0]=SVR&code[1]=TOR

const obs = new OBSWebSocket();
let isConnected = false;

let activeAlerts = [];
let alertQueue = [];
let isQueing = false;
let isHandling = false;
let activeNumber = 0;

const boxenOptions = {
  padding: 1,
  margin: 1,
  borderStyle: "round",
  borderColor: "green",
  backgroundColor: "#555555",
};

async function Connect() {
  try {
    await obs.connect(
      `ws://${config.serverSettings.socketIp}:${config.serverSettings.socketPort}`,
      config.serverSettings.socketPassword
    );
    isConnected = true;
    console.log("Connected to OBS WebSocket Server");
  } catch (e) {
    console.error(`Failed to Connect to the OBS WebSocket Server. Error: ${e}`);
  }
}

function LogDebug(string) {
  if (config.developerSettings.enableDebugMessages && string) {
    console.log(string);
  }
}

function GetEventCodeFromEventName(name) {
  switch (name) {
    case "Tornado Warning":
      return "TOR";
    case "Severe Thunderstorm Warning":
      return "SVR";
    case "Tornado Watch":
      return "TOA";
    case "Severe Thunderstorm Watch":
      return "SVA";
    default:
      return null;
  }
}

function ResetDataFiles() {
  try {
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
  } catch (err) {
    console.log(err);
  }
}

function WriteWarnCount() {
  try {
    const validWarnCountVars = {
      warnCount: activeAlerts.length,
    };

    fs.writeFile(
      "./data/WarnCount.txt",
      mustache.render(
        config.formattingSettings.warnCountFormat,
        validWarnCountVars
      ),
      (err) => {
        if (err) {
          console.error(err);
        }
      }
    );
  } catch (err) {
    console.log(err);
  }
}

async function HandleQueue() {
  try {
    LogDebug("Handling Queue");
    isQueing = true;

    if (isConnected && alertQueue.length > 0) {
      LogDebug(activeAlerts);
      activeAlert = activeAlerts.find((a) => a.id === alertQueue[0]);
      if (activeAlert && !activeAlert.isShown) {
        const { currentProgramSceneName } = await obs.call(
          "GetCurrentProgramScene"
        );

        LogDebug(
          config.obsSourceSettings[
            GetEventCodeFromEventName(activeAlert.event)
          ] || config.obsSourceSettings[activeAlert.event]
        );
        const { sceneItemId } = await obs.call("GetSceneItemId", {
          sceneName: currentProgramSceneName,
          sourceName:
            config.obsSourceSettings[
              GetEventCodeFromEventName(activeAlert.event)
            ] || config.obsSourceSettings[activeAlert.event],
        });

        const validAlertVars = {
          alertName: activeAlert.event,
          alertAreas: activeAlert.areaDesc,
          alertCertainty: activeAlert.certainty,
        };

        fs.writeFile(
          "./data/AlertName.txt",
          mustache.render(
            config.formattingSettings.alertFormats.alertTitleFormat,
            validAlertVars
          ),
          (err) => {
            if (err) {
              console.error(err);
            }
          }
        );
        fs.writeFile(
          "./data/AlertDesc.txt",
          mustache.render(
            config.formattingSettings.alertFormats.alertDescriptionFormat,
            validAlertVars
          ),
          (err) => {
            if (err) {
              console.error(err);
            }
          }
        );
        await new Promise((resolve) => setTimeout(resolve, 2000));

        await obs.call("SetSceneItemEnabled", {
          sceneName: currentProgramSceneName,
          sceneItemId: sceneItemId,
          sceneItemEnabled: true,
        });
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            config.timeSettings.durationAlertIsShownFor || 10000
          )
        );
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
      HandleQueue();
    } else {
      isQueing = false;
    }
  } catch (err) {
    console.log(err);
  }
}

function ApiSuccess(res) {
  try {
    isHandling = true;
    const alerts = res.data.features;
    newAlerts = [];
    alerts.forEach((alert) => {
      LogDebug(alert);

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
    if (config.enableSettings.enableWarnCount) {
      WriteWarnCount();
    }

    if (!isQueing) {
      HandleQueue();
    }

    let alertList = "";
    newAlerts.forEach((alert) => {
      alertList = `${alertList}\n${alert.displayName}`;
    });
    const alertString = `Active Alert Count: ${activeAlerts.length} - Queue Length: ${alertQueue.length} Alerts in Queue - Active Alerts:\n${alertList}\n`;

    const msg = boxen(alertString, boxenOptions);
    console.log(msg);

    isHandling = false;
  } catch (err) {
    console.log(err);
  }
}

function Loop() {
  if (!isHandling) {
    axios
      .get(alertApiUrl, {
        params: {
          status: "actual",
          code: config.triggerSettings.triggerWarns || ["SVR", "TOR"],
        },
      })
      .then((res) => {
        LogDebug("Request Successful");
        ApiSuccess(res);
      })
      .catch((err) => {
        console.log(err);
      });
  }
}

function AlertListLoop() {
  try {
    if (activeAlerts.length > 0) {
      activeNumber += 1;
      if (activeNumber > activeAlerts.length - 1) {
        activeNumber = 0;
      }

      const validAlertVars = {
        alertName: activeAlerts[activeNumber].event,
        alertAreas: activeAlerts[activeNumber].areaDesc,
        alertCertainty: activeAlerts[activeNumber].certainty,
      };

      fs.writeFile(
        "./data/ActiveAlertTitle.txt",
        mustache.render(
          config.formattingSettings.alertListFormats.activeAlertTitleFormat,
          validAlertVars
        ),
        (err) => {
          if (err) {
            console.error(err);
          }
        }
      );
      fs.writeFile(
        "./data/ActiveAlertText.txt",
        mustache.render(
          config.formattingSettings.alertListFormats
            .activeAlertDescriptionFormat,
          validAlertVars
        ),
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
  } catch (err) {
    console.log(err);
  }
}

ResetDataFiles();
Connect();
//Loop();
if (
  config.enableSettings.enableAlerts ||
  config.enableSettings.enableWarnCount
) {
  setInterval(Loop, config.timeSettings.timeBetweenAlertChecks || 5000);
}

if (config.enableSettings.enableAlertsList) {
  setInterval(
    AlertListLoop,
    config.timeSettings.timeBetweenAlertListChange || 8000
  );
}
