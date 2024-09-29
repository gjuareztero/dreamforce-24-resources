import getAccessToken from "@salesforce/apex/PubSubAPIClient.getAccessToken";

export default class PubSubAPIClient {
    webSocketConnection;
    webSocket;

    subscriptions = {};

    async connect() {
        await this.generateAccessToken();
        this.webSocket = await this.connectToWebSocket();
        await this.webSocketConnected();
    }

    generateAccessToken = async () => {
        try {
            this.webSocketConnection = await getAccessToken();
            this.error = undefined;
            console.log("Token Retrieved");
        } catch (error) {
            console.log("Error Generating Access Token");
            this.webSocketConnection = undefined;
            this.error = error;
        }
    };

    subscribe = async (channel, callback) => {
        if (!this.webSocketConnection && !this.webSocket) {
            await this.connect();
        }
        this.subscriptions = { ...this.subscriptions, [channel]: callback };
        this.webSocket.send(JSON.stringify({ eventType: "subscribe", channel }));
    };

    publish = async ({ channel, payload }) => {
        const data = {
            eventType: "publish",
            channel,
            payload
        };

        this.webSocket.send(JSON.stringify(data));
    };

    connectToWebSocket = () => {
        return new Promise((resolve, reject) => {
            const server = new WebSocket(`${this.webSocketConnection.url}/connect?userId=${this.webSocketConnection.userId}`, [
                this.webSocketConnection.accessToken
            ]);
            server.onopen = () => resolve(server);
            server.onerror = (error) => reject(error);
        });
    };

    webSocketConnected = async () => {
        this.webSocket.onmessage = this.handleNewMessage;
        this.webSocket.onclose = () => {
            console.log("Connection Closed");
        };
    };

    handleNewMessage = (event) => {
        const { channel, payload, error } = JSON.parse(event.data);
        if (error) {
            console.log(error);
        } else if (channel != null && payload != null) {
            this.subscriptions[channel](payload);
        }
    };

    sendWebSocketMessage(data) {
        this.webSocket.send(JSON.stringify(data));
    }
}
