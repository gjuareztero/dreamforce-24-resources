import { LightningElement, api, wire } from "lwc";
import getUsers from "@salesforce/apex/OnlineUsersController.getUsers";
import Id from "@salesforce/user/Id";

import PubSubAPIClient from "c/pubSubAPIClient";

export default class OnlineUsers extends LightningElement {
    @api recordId;
    onlineUsers = [];
    usersWithDetails = [];
    
    pubSubAPIClient = new PubSubAPIClient();

    async connectedCallback() {
        await this.subscribeToOnlineUsersEvent();
        await this.publishOpenRecordEvent();
    }

    subscribeToOnlineUsersEvent = async () => {
        await this.pubSubAPIClient.subscribe("/event/Online_Users_Update__e", this.handleOnlineUsersUpdate);
    }

    disconnectedCallback() {
        this.pubSubAPIClient.publish({
            channel: "/event/Close_Record__e",
            payload: {
                Record_Id__c: { string: this.recordId },
                User_Id__c: { string: Id }
            }
        });
    }

    @wire(getUsers, { userIds: "$userIds" })
    getUserDetails({ data, errors }) {
        if (data) {
            this.usersWithDetails = data;
        }
        this.errors = errors;
    }

    get userIds() {
        return this.onlineUsers?.filter((id) => id !== Id);
    }

    get displayOnlineUsers() {
        return this.usersWithDetails != null && this.usersWithDetails?.length > 0;
    }

    handleOnlineUsersUpdate = (payload) => {
        console.log("payload received", payload);
        console.log("record Id", payload.Record_Id__c);
        try {
            if (payload.Record_Id__c === this.recordId) {
                console.log("Extending Online Users");
                this.onlineUsers = [...JSON.parse(payload.User_Ids__c)];
            }
        } catch (error) {
            console.error(error);
        }
    };

    publishOpenRecordEvent = async () => {
        const payload = {
            Record_Id__c: { string: this.recordId },
            User_Id__c: { string: Id }
        };
        await this.pubSubAPIClient.publish({
            channel: "/event/Open_Record__e",
            payload
        });
    }
}
