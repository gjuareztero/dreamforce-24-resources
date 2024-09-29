import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { Connection } from "jsforce";
import { createServer } from "node:http";
import PubSubApiClient from "salesforce-pubsub-api-client";
import url from "url";
import { v4 as uuidv4 } from "uuid";
import { WebSocketServer } from "ws";

export default class PubSubAPIServer {
    #app = express();
    #server;

    #pubSubAPI;
    #webSocketServer;
    #salesforceConnection;

    userInfo = {};
    enableCheckPermissions = false;

    #connectionsByUserId = {};
    #connections = {};
    #subscribers = {};

    connectionClosedCallback;

    constructor() {
        if (process.env.NODE_ENV !== "production") dotenv.config();
    }

    start = async () => {
        await this.#startExpressServer();
        await this.#connectToPubSubAPI();
        await this.#authorizeSalesforceUser();
        await this.#startWebSocketServer();
        this.#enableKeepAlive();
    };

    #startExpressServer = async () => {
        this.#app = express();
        this.#app.use(cors());
        this.#app.use(express.json());
        this.#server = createServer(this.#app);
        this.#server.listen(process.env.PORT || 30000);
    };

    #connectToPubSubAPI = async () => {
        this.#pubSubAPI = new PubSubApiClient();
        await this.#pubSubAPI.connect();
    };

    #authorizeSalesforceUser = async () => {
        this.#salesforceConnection = new Connection({
            instanceUrl: process.env.SALESFORCE_LOGIN_URL,
            oauth2: {
                clientId: process.env.SALESFORCE_CLIENT_ID,
                clientSecret: process.env.SALESFORCE_CLIENT_SECRET,
                loginUrl: process.env.SALESFORCE_LOGIN_URL
            }
        });
        this.userInfo = await this.#salesforceConnection.authorize({
            grant_type: "client_credentials"
        });
    };

    #startWebSocketServer = async () => {
        this.#webSocketServer = new WebSocketServer({ server: this.#server });

        this.#webSocketServer.on("connection", async (ws, req) => {
            console.log("Connection Requested");
            const reqUrl = url.parse(req.url, true);

            await this.#authorizeClient({ ws, req, reqUrl });

            if (reqUrl.pathname == "/connect") {
                let userId = reqUrl.query.userId;
                const uuid = uuidv4();
                this.#connections[uuid] = ws;

                if (!this.#connectionsByUserId.hasOwnProperty(userId)) {
                    this.#connectionsByUserId[userId] = new Set();
                }
                this.#connectionsByUserId[userId].add(uuid);

                ws.on("message", async (data) => {
                    await this.#handleMessage({
                        data: JSON.parse(data),
                        userId,
                        ws
                    });
                });

                ws.on("close", async (data) => {
                    console.log("Connection closed", uuid);
                    this.#connections[uuid] = null;
                    delete this.#connections[uuid];
                    this.#connectionsByUserId[userId].delete(uuid);
                    if (this.connectionClosedCallback) {
                        this.connectionClosedCallback({ userId });
                    }
                });

                ws.onerror = function () {
                    console.log("Websocket error");
                    if (this.#connections[uuid]) {
                        this.#connections[uuid] = null;
                        delete this.#connections[uuid];
                        if (this.#connectionsByUserId[userId]) {
                            this.#connectionsByUserId[userId].delete(uuid);
                        }
                    }
                    ws.close();
                };
                console.log("Connection Accepted", uuid);
            } else {
                console.log("Connection Rejected");
                ws.send("Unrecognized Request");
                ws.close();
            }
        });
    };

    #enableKeepAlive = () => {
        setInterval(() => {
            if (this.#webSocketServer && this.#webSocketServer.clients && this.#webSocketServer.clients.forEach) {
                this.#webSocketServer?.clients?.forEach((ws) => ws.send("{}"));
            }
        }, 20000);
    };

    #handleMessage = async ({ data, userId, ws }) => {
        try {
            switch (data?.eventType) {
                case "subscribe":
                    await this.#subscribeToPubSubAPIEvents({
                        data,
                        userId,
                        ws
                    });
                    break;
                case "publish":
                    await this.#publishEvent({ data, userId, ws });
                    break;
                default:
                    break;
            }
        } catch (err) {
            console.log("Error handling message from user " + userId, err);
        }
    };

    #subscribeToPubSubAPIEvents = async ({ data, userId, ws }) => {
        let eventPermissions = await this.#checkUserPermission({
            channel: data.channel,
            userId
        });
        if (eventPermissions.IsReadable) {
            if (this.#subscribers[data.channel] == undefined) {
                this.#subscribers[data.channel] = new Set();
                await this.subscribeToEvents({
                    channel: data.channel,
                    eventHandler: this.#pubSubAPIEventHandler
                });
            }
            this.#subscribers[data.channel].add(userId);
        } else {
            ws.send(
                JSON.stringify({
                    error: `No access or invalid channel name (${data.channel})`
                })
            );
        }
    };

    subscribeToEvents = async ({ channel, eventHandler }) => {
        try {
            const eventEmitter = await this.#pubSubAPI.subscribe(channel);
            eventEmitter.on("data", (event) => {
                eventHandler({ event, channel });
            });
            eventEmitter.on("error", (error) => {
                console.log("Error emitted", error);
            });
        } catch (error) {
            console.log("Subscription error", error);
        }
    };

    #pubSubAPIEventHandler = ({ event, channel }) => {
        for (const subscriber of this.#subscribers[channel]) {
            for (const uuid of this.#connectionsByUserId[subscriber]) {
                this.#connections[uuid].send(JSON.stringify({ channel, payload: event.payload }));
            }
        }
    };

    #publishEvent = async ({ data, userId, ws }) => {
        //Check Schemma and set data types
        let eventPermissions = await this.#checkUserPermission({
            channel: data.channel,
            userId
        });
        if (eventPermissions.IsCreatable) {
            data.payload.CreatedDate = new Date().getTime();
            data.payload.CreatedById = userId;
            console.log("Publishing to channel " + data.channel, data.payload);
            await this.publish(data.channel, data.payload);
        } else if (ws) {
            ws.send(
                JSON.stringify({
                    error: `No access or invalid channel name (${data.channel})`
                })
            );
        } else {
            console.log(`No access or invalid channel name (${data.channel})`);
        }
    };

    publish = async (channel, payload) => {
        await this.#pubSubAPI.publish(channel, payload);
    };

    #authorizeClient = async ({ ws, req, reqUrl }) => {
        //Check One-time Token
    };

    #checkUserPermission = async ({ channel, userId }) => {
        if (!this.enableCheckPermissions) {
            return { IsReadable: true, IsCreatable: true };
        }
        try {
            let channelName = channel.split("/")[2];
            const res = await this.#salesforceConnection.query(`
            SELECT IsReadable, IsCreatable
            FROM UserEntityAccess WHERE UserId='${userId}' AND EntityDefinition.QualifiedApiName = '${channelName}'
            `);
            if (res.totalSize > 0) {
                return res.records[0];
            }
        } catch (err) {
            console.log(err);
            return {};
        }
    };
}
