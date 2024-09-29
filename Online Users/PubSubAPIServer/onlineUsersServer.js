import PubSubAPIServer from "./pubSubAPIServer.js";

const onlineUsersByRecord = {};

const pubSubAPIServer = new PubSubAPIServer();
await pubSubAPIServer.start();

await pubSubAPIServer.subscribeToEvents({
    channel: "/event/Close_Record__e",
    eventHandler: async ({ event }) => {
        if (onlineUsersByRecord[event.payload.Record_Id__c]) {
            delete onlineUsersByRecord[event.payload.Record_Id__c][event.payload.User_Id__c];
        }
        await publishOnlineUsersEvent(event);
    }
});

await pubSubAPIServer.subscribeToEvents({
    channel: "/event/Open_Record__e",
    eventHandler: async ({ event }) => {
        if (!onlineUsersByRecord[event.payload.Record_Id__c]) {
            onlineUsersByRecord[event.payload.Record_Id__c] = {};
        }
        onlineUsersByRecord[event.payload.Record_Id__c][event.payload.User_Id__c] = Date.now();
        await publishOnlineUsersEvent(event);
    }
});

const publishOnlineUsersEvent = async (event) => {
    //Check users who recently watched a record
    let onlineUsers = [];
    let lastConnections = onlineUsersByRecord[event.payload.Record_Id__c];
    for (const userId in lastConnections) {
        if (Object.hasOwnProperty.call(lastConnections, userId)) {
            if (Date.now() - lastConnections[userId] < 60000) {
                onlineUsers.push(userId);
            }
        }
    }

    //Publish Event with all the users watching a record
    await pubSubAPIServer.publish("/event/Online_Users_Update__e", {
        CreatedDate: new Date().getTime(),
        CreatedById: event.payload.User_Id__c,
        Record_Id__c: { string: event.payload.Record_Id__c },
        User_Ids__c: { string: JSON.stringify(onlineUsers) }
    });
};
