// A bridge between OBS websocket and OSC

// Install libs: npm install
// Run: npm start

const chalk = require("chalk");
const OBSWebSocket = require("obs-websocket-js");
const { Client, Server } = require("node-osc");
const obs = new OBSWebSocket();

// OBS Config
const obsIp = "127.0.0.1";
const obsPort = 4444;
const obsPassword = "secret";
// OSC Server (IN) Config
const oscServerIp = "0.0.0.0";  // Listen IP, set to 0.0.0.0 to listen on all interfaces
const oscPortIn = 3333;
// OSC Client (OUT) Config - i.e. sending OSC to QLab
const oscClientIp = "127.0.0.1";  // QLab IP
const oscPortOut = 53000;
// Enable OBS -> OSC Control
const enableObs2Osc = false;

// Cache last transition so we know how to trigger it (cut works differently to all the others)
// See https://github.com/Palakis/obs-websocket/blob/4.x-current/docs/generated/protocol.md#transitionbegin
var lastTransition = null;  /* eslint no-var: "off" */


// Connect to OBS
obs.connect({
    address: obsIp + ":" + obsPort,
    password: obsPassword,
}).then(() => {
    console.log(`[+] Connected to OBS websocket OK (${obsIp}:${obsPort})`);
    return obs.send("GetVersion");
}).then(data => {
    console.log(`\nOBS Version: ${data.obsStudioVersion}`);
    console.log(`OBS Websocket Version: ${data.obsWebsocketVersion}\n`);
    return obs.send("GetCurrentTransition");
}).then(data => {
    // Cache current screen transition
    lastTransition = data.name;
    console.log(`[+] Cached current transition: "${data.name}"`);
}).catch(err => {
    console.log(err);
    console.log(chalk.red("[!] Make sure OBS is running and websocket IP/port/password are correct!"));
});


// Handler to avoid uncaught exceptions
obs.on("error", err => {
    console.error("socket error:", err);
});

// Connect to OSC
const client = new Client(oscClientIp, oscPortOut);
const server = new Server(oscPortIn, oscServerIp);

// OSC Server (IN)
server.on("listening", () => {
    console.log(`[+] OSC Server is listening on ${oscServerIp}:${oscPortIn}`);
    console.log(`[+] OSC Server is sending back on ${oscClientIp}:${oscPortOut}`);
});

// OSC -> OBS
server.on("message", (msg) => {
    console.log(chalk.blue("OSC IN:"), msg);
    if (msg.length < 1) {
        return;
    }
    let msgArray = msg[0].split("/");
    console.log(chalk.grey("msgArray:"), msgArray);

    if (msg[0] === "/ping") {
        console.log(chalk.green("[+] Ping received"));
    }

    /*
     * SCENES (transition to immediately)
     */

    // Trigger scene by index number
    // /scene [index]
    else if (msg[0] === "/scene" && typeof msg[1] === "number" && msg.length === 2) {
        let index = msg[1] - 1;  // Convert index number to start at 1
        index = Math.floor(index);  // Converts any float argument to lowest integer
        return obs.send("GetSceneList").then(data => {
            if (index > data.scenes.length - 1) throw new Error("Out of '/scene' range");
            console.log(`> SetCurrentScene: '${data.scenes[index].name}'`);
            obs.send("SetCurrentScene", {
                "scene-name": data.scenes[index].name,
            });
        }).catch((err) => {
            console.log(chalk.red(`[!] ${err}`));
        });
    }

    // Trigger scene if argument is a string (no spaces)
    // /scene [scene-name]
    else if (msg[0] === "/scene" && typeof msg[1] === "string" && msg.length === 2) {
        let sceneName = msg[1];
        console.log(`> SetCurrentScene: '${sceneName}'`);
        obs.send("SetCurrentScene", {
            "scene-name": sceneName,
        }).catch((err) => {
            if (err.error === "requested scene does not exist") {
                console.log(chalk.red(`[!] There is no scene '${msg[1]}' in OBS. Double check case sensitivity.`));
            } else {
                console.log(chalk.red(`[!] ${err.error}`));
            }
        });
    }

    // Trigger scene if scene name is in the OSC string
    // /scene/[scene-name]
    else if (msgArray.length === 3 && msgArray[1] === "scene" && msg.length === 1) {
        console.log(`> SetCurrentScene: '${msgArray[2]}'`);
        obs.send("SetCurrentScene", {
            "scene-name": msgArray[2],
        }).catch((err) => {
            if (err.error === "requested scene does not exist") {
                console.log(chalk.red(`[!] There is no scene '${msgArray[2]}' in OBS. Double check case sensitivity.`));
            } else {
                console.log(chalk.red(`[!] ${err.error}`));
            }
        });
    }

    // Triggers to "GO" to the next scene
    // /go
    else if (msg[0] === "/go" && msg.length === 1) {
        return obs.send("GetSceneList").then(data => {
            let scenes = data.scenes.map(e => e.name);
            let currentIndex = scenes.indexOf(data.currentScene);
            let nextScene;
            if (currentIndex === scenes.length - 1) {
                nextScene = scenes[0];
            } else {
                nextScene = scenes[currentIndex + 1];
            }
            console.log(`> SetCurrentScene: '${nextScene}'`);
            obs.send("SetCurrentScene", {
                "scene-name": nextScene,
            });
        });
    }

    // Triggers previous scene to go "BACK"
    // /back
    else if (msg[0] === "/back" && msg.length === 1) {
        return obs.send("GetSceneList").then(data => {
            let scenes = data.scenes.map(e => e.name);
            let currentIndex = scenes.indexOf(data.currentScene);
            let prevScene;
            if (currentIndex === 0) {
                prevScene = scenes[scenes.length - 1];
            } else {
                prevScene = scenes[currentIndex - 1];
            }
            console.log(`> SetCurrentScene: '${prevScene}'`);
            obs.send("SetCurrentScene", {
                "scene-name": prevScene,
            });
        });
    }

    /*
     * PREVIEW SCENES (when using studio mode)
     */

    // Preview scene with scene name as argument (no spaces)
    // /previewScene [scene-name]
    else if (msg[0] === "/previewScene" && typeof msg[1] === "string" && msg.length === 2) {
        let sceneName = msg[1];
        console.log(`> SetPreviewScene: '${sceneName}'`);
        obs.send("SetPreviewScene", {
            "scene-name": sceneName,
        }).catch((err) => {
            if (err.error === "studio mode not enabled") {
                console.log(chalk.red("[!] Failed to set preview scene, studio mode is not enabled"));
            } else {
                console.log(chalk.red(`[!] ${err.error}`));
            }
        });
    }

    // Triggers start recording
    else if (msg[0] === "/startRecording" && msg.length === 1) {
        console.log("> StartRecording");
        obs.send("StartRecording").catch((err) => {
            console.log(chalk.red(`[!] ${err.error}`));
        });
    }

    // Triggers stop recording
    else if (msg[0] === "/stopRecording" && msg.length === 1) {
        console.log("> StopRecording");
        obs.send("StopRecording").catch((err) => {
            console.log(chalk.red(`[!] ${err.error}`));
        });
    }

    // Triggers toggle recording
    else if (msg[0] === "/toggleRecording" && msg.length === 1) {
        console.log("> StartStopRecording");
        obs.send("StartStopRecording").catch((err) => {
            console.log(chalk.red(`[!] ${err.error}`));
        });
    }

    // Triggers start streaming
    else if (msg[0] === "/startStreaming" && msg.length === 1) {
        console.log("> StartStreaming");
        obs.send("StartStreaming").catch((err) => {
            console.log(chalk.red(`[!] ${err.error}`));
        });
    }

    // Triggers stop streaming
    else if (msg[0] === "/stopStreaming" && msg.length === 1) {
        console.log("> StopStreaming");
        obs.send("StopStreaming").catch((err) => {
            console.log(chalk.red(`[!] ${err.error}`));
        });
    }

    // Triggers toggle streaming
    else if (msg[0] === "/toggleStreaming" && msg.length === 1) {
        console.log("> StartStopStreaming");
        obs.send("StartStopStreaming").catch((err) => {
            console.log(chalk.red(`[!] ${err.error}`));
        });
    }

    // Triggers pause recording
    else if (msg[0] === "/pauseRecording" && msg.length === 1) {
        console.log("> PauseRecording");
        obs.send("PauseRecording").catch((err) => {
            console.log(chalk.red(`[!] ${err.error}`));
        });
    }

    // Triggers resume recording
    else if (msg[0] === "/resumeRecording" && msg.length === 1){
        console.log("> ResumeRecording");
        obs.send("ResumeRecording").catch((err) => {
            console.log(chalk.red(`[!] ${err.error}`));
        });
    }

    // Triggers enable studio mode
    else if (msg[0] === "/enableStudioMode" && msg.length === 1) {
        console.log("> EnableStudioMode");
        obs.send("EnableStudioMode").catch((err) => {
            console.log(chalk.red(`[!] ${err.error}`));
        });
    }

    // Triggers disable studio mode
    else if (msg[0] === "/disableStudioMode" && msg.length === 1) {
        console.log("> DisableStudioMode");
        obs.send("DisableStudioMode").catch((err) => {
            console.log(chalk.red(`[!] ${err.error}`));
        });
    }

    // Triggers toggle studio mode
    else if (msg[0] === "/toggleStudioMode" && msg.length === 1) {
        console.log("> ToggleStudioMode");
        obs.send("ToggleStudioMode").catch((err) => {
            console.log(chalk.red(`[!] ${err.error}`));
        });
    }

    // Triggers source visibility on/off
    // /scene/[scene-name]/[source-name]/visible [0|1|off|on]
    else if (msgArray.length === 5 && msgArray[1] === "scene" && msgArray[4] === "visible" && msg.length === 2) {
        let visible;
        if (msg[1] === 0 || msg[1] === "off") {
            visible = false;
        } else if (msg[1] === 1 || msg[1] === "on") {
            visible = true;
        } else {
            console.log(chalk.red("[!] Invalid syntax. Visibility must be [0|1|off|on]."));
            return;
        }
        console.log(`> SetSceneItemProperties: '${msgArray[2]}' '${msgArray[3]}' ${visible}`);
        obs.send("SetSceneItemProperties", {
            "scene-name": msgArray[2],
            "item": msgArray[3],
            "visible": visible,
        }).catch((err) => {
            console.log(chalk.red(`[!] ${err.error}`));
        });
    }

    // Triggers filter visibility on/off
    // /source/[source-name]/filter/[filter-name] [0|1|off|on]
    else if (msgArray.length === 5 && msgArray[1] === "source" && msgArray[3] === "filter" && msg.length === 2) {
        let visible;
        if (msg[1] === 0 || msg[1] === "off") {
            visible = false;
        } else if (msg[1] === 1 || msg[1] === "on") {
            visible = true;
        } else {
            console.log(chalk.red("[!] Invalid syntax. Filter must be [0|1|off|on]."));
            return;
        }
        console.log(`> SetSourceFilterVisibility: '${msgArray[2]}' '${msgArray[4]}' ${visible}`);
        obs.send("SetSourceFilterVisibility", {
            "sourceName": msgArray[2],
            "filterName": msgArray[4],
            "filterEnabled": visible,
        }).catch((err) => {
            console.log(chalk.red(`[!] ${err.error}`));
        });
    } 

    // Triggers the source opacity (via filter > color correction)
    else if (msg[0].includes("opacity")) {
        console.log(`OSC IN: ${msg[0]} ${msg[1]}`);
        let msgArray = msg[0].split("/");
        msgArray.shift();
        obs.send("SetSourceFilterSettings", {
            "sourceName": msgArray[0].split("_").join(" "),
            "filterName": msgArray[1].split("_").join(" "),
            "filterSettings": {"opacity": msg[1]*100},
        }).catch(() => {
            console.log(chalk.red("[!] Opacity command incorrect syntax."));
        });
    }

    // Set transition type and duration
    else if (msg[0] === "/transition") {
        if (msg[1] === "Cut" || msg[1] === "Stinger") {
            console.log(`OSC IN: ${msg[0]} ${msg[1]}`);
            obs.send("SetCurrentTransition", {
                "transition-name": msg[1].toString(),
            }).catch(() => {
                console.log(chalk.red(`[!] Transition '${msg[1].toString()}' does not exist`));
            });
        } else if (msg[1] === "Fade" || msg[1] === "Move" || msg[1] === "Luma_Wipe" || msg[1] === "Fade_to_Color" || msg[1] === "Slide" || msg[1] === "Swipe") {
            if (msg[2] === undefined) {
                obs.send("GetTransitionDuration").then(data => {
                    console.log(`OSC IN: ${msg[0]} ${msg[1]}\nCurrent Duration: ${data["transition-duration"]}`);
                });
            } else {
                console.log(`OSC IN: ${msg[0]} ${msg[1]} ${msg[2]}`);
            }
            let makeSpace = msg[1].split("_").join(" ");  // TODO get rid of confusing replace and just disallow spaces in scene names
            obs.send("SetCurrentTransition", {
                "transition-name": makeSpace.toString(),
            });
            if (msg.length === 3) {
                obs.send("SetTransitionDuration", {
                    "duration": msg[2],
                });
            }
        } else {
            console.log(chalk.red("[!] Invalid transition name. If it contains spaces use '_' instead."));
        }
    }

    // Source position translate
    else if (msg[0].includes("position")) {
        console.log(`OSC IN: ${msg}`);
        let msgArray = msg[0].split("/");
        msgArray.shift();
        let x = msg[1] + 960;
        let y = msg[2] - (msg[2] * 2);
        obs.send("SetSceneItemProperties", {
            "scene-name": msgArray[0].toString().split("_").join(" "),
            "item": msgArray[1].toString().split("_").join(" "),
            "position": {"x": x, "y": y + 540},
        }).catch(() => {
            console.log(chalk.red("[!] Invalid position syntax"));
        });
    }

    // Source scale translate
    else if (msg[0].includes("scale")) {
        console.log(`OSC IN: ${msg}`);
        let msgArray = msg[0].split("/");
        msgArray.shift();
        obs.send("SetSceneItemProperties", {
            "scene-name": msgArray[0].split("_").join(" ").toString(),
            "item": msgArray[1].split("_").join(" ").toString(),
            "scale": {"x": msg[1], "y": msg[1]},
        }).catch(() => {
            console.log(chalk.red("[!] Invalid scale syntax. Make sure there are NO SPACES in scene name and source name. /[sceneName]/[sourceName]/scale 0 or 1, e.g.: /Wide/VOX/scale 1"));
        });
    }

    // Source rotation translate
    else if (msg[0].includes("rotate")) {
        console.log(`OSC IN: ${msg}`);
        let msgArray = msg[0].split("/");
        msgArray.shift();
        obs.send("SetSceneItemProperties", {
            "scene-name": msgArray[0].split("_").join(" ").toString(),
            "item": msgArray[1].split("_").join(" ").toString(),
            "rotation": msg[1],
        }).catch(() => {
            console.log(chalk.red("[!] Invalid rotation syntax. Make sure there are NO SPACES in scene name and source name. /[sceneName]/[sourceName]/rotate 0 or 1, e.g.: /Wide/VOX/rotate 1"));
        });
    }

    /*
     * TOUCHOSC COMMANDS
     */

    // Source position select move
    else if (msg[0] === "/move") {
        return obs.send("GetCurrentScene").then(data => {
            console.log(`OSC IN: ${msg}`);
            let msgArray = msg[0].split("/");  // FIXME: this doesn't do anything, nor the next line
            msgArray.shift();
            let x = Math.floor(msg[2]*2000);
            let y = Math.floor((msg[1]*2000) + 960);
            console.log(x + " " + y);
            obs.send("SetSceneItemProperties", {
                "scene-name": data.name,
                "item": currentSceneItem,  // FIXME: wtf this doesn't exist
                "position": {"x": x + 540, "y": y, "alignment": 0}
            }).catch(() => {
                console.log(chalk.red("[!] Invalid position syntax"));
            });
        });
    }

    // Source position select moveX
    else if (msg[0] === "/movex"){
        return obs.send("GetCurrentScene").then(data => {
            console.log(`OSC IN: ${msg}`);
            let msgArray = msg[0].split("/");  // FIXME: this doesn't do anything, nor the next line
            msgArray.shift();
            let x = Math.floor(msg[1]*2000);
            let y = Math.floor((msg[1]*2000) + 960);
            console.log(x + " " + y);
            obs.send("SetSceneItemProperties", {
                "scene-name": data.name,
                "item": currentSceneItem,  // FIXME: wtf this doesn't exist
                "position": {"x": x + 540, "alignment": 0}
            }).catch(() => {
                console.log(chalk.red("[!] Invalid position syntax"));
            });
        });
    }

    // Source position select moveY
    else if (msg[0] === "/movey") {
        return obs.send("GetCurrentScene").then(data => {
            console.log(`OSC IN: ${msg}`);
            let msgArray = msg[0].split("/");  // FIXME: this doesn't do anything, nor the next line
            msgArray.shift();
            let x = Math.floor((msg[2]*2000));
            let y = Math.floor((msg[1]*2000) + 960);
            console.log(x + " " + y);
            obs.send("SetSceneItemProperties", {
                "scene-name": data.name,
                "item": currentSceneItem,  // FIXME: wtf this doesn't exist
                "position": {"y": y, "alignment": 0}
            }).catch(() => {
                console.log(chalk.red("[!] Invalid position syntax"));
            });
        });
    }

    // Source align
    else if (msg[0] === "/align") {
        return obs.send("GetCurrentScene").then(data => {
            console.log(`OSC IN: ${msg}`);
            let x = 960;
            let y = 540;
            obs.send("SetSceneItemProperties", {
                "scene-name": data.name.toString(),
                "item": currentSceneItem,  // FIXME: wtf this doesn't exist
                "position": {"x": x, "y":y, "alignment": msg[1]}
            }).catch(() => {
                console.log(chalk.red("[!] Select a scene item in OBS for alignment"));
            });
        });
    }

    // Set transition override
    else if (msg[0].includes("/transOverrideType")) {
        console.log(`OSC IN: ${msg}`);
        let msgArray = msg[0].split("/");
        msgArray.shift();
        console.log("Messge array: " + msgArray);
        return obs.send("GetCurrentScene").then(data => {
            obs.send("SetSceneTransitionOverride", {
                "sceneName": data.name,
                "transitionName": msgArray[1].toString(),
            });
        });
    }

    // Set transition override
    else if(msg[0] === "/transOverrideDuration") {
        let currentSceneName;
        console.log(`OSC IN: ${msg}`);
        return obs.send("GetCurrentScene").then(data => {
            currentSceneName = data.name;
            return obs.send("GetSceneTransitionOverride", {
                "sceneName": currentSceneName,
            }).then(data => {
                obs.send("SetSceneTransitionOverride", {
                    "sceneName": currentSceneName,
                    "transitionName": data.transitionName,
                    "transitionDuration": Math.floor(msg[1]),
                });
            });
        });
    }

    // Source size
    else if (msg[0] === "/size") {
        return obs.send("GetCurrentScene").then(data => {
            console.log(`OSC IN: ${msg}`);
            obs.send("SetSceneItemProperties", {
                "scene-name": data.name.toString(),
                "item": currentSceneItem,
                "scale": {"x": msg[1], "y": msg[1]}
            }).catch(() => {
                console.log(chalk.red("Error: Select a scene item in OBS for size"));
            });
        });
    }

    // Log catch-all error
    else {
        console.log(chalk.red("[!] Invalid OSC command. Please refer to Node OBSosc on Github for command list"));
    }
});


/*
 * OBS -> OSC
 */
function sceneTrigger(sceneName) {
    // Extract QLab cue number from OBS scene if specified e.g. "My Scene [target]"
    let cueNumber = sceneName.substring(
        sceneName.lastIndexOf("[") + 1, sceneName.lastIndexOf("]")
    );
    if (!cueNumber) return;  // Scene doesn't request any cues to be triggered
    console.log(`  Cue triggered: "${cueNumber}"`);
    // Trigger cue with extracted cue number
    client.send(`/cue/${cueNumber}/start`, (err) => {
        if (err) console.error(err);
    });
}
obs.on("SwitchScenes", data => {
    if (enableObs2Osc && lastTransition === "Cut") {
        console.log(`Scene change: ${data.sceneName} (lastTransition: "${lastTransition}")`);
        sceneTrigger(data.sceneName);
    }
});
obs.on("TransitionBegin", data => {
    if (enableObs2Osc && lastTransition !== "Cut") {
        console.log(`Transition started: ${data.toScene} (lastTransition: "${lastTransition}")`);
        sceneTrigger(data.toScene);
    }
});
obs.on("SwitchTransition", data => {
    console.log(`[+] Transition changed to: "${data.transitionName}"`);
    lastTransition = data.transitionName;
});
