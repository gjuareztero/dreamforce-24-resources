public class PubSubAPIClient {
    private static final String REQUEST_ACCESS_TOKEN_URL = 'callout://WebSocketServer/token';
    
    @AuraEnabled(cacheable=true)
    public static WebSocketConnection getAccessToken(){
        try {
            WebSocketConnection wss = new WebSocketConnection();
            wss.url = 'wss://your-url-for.herokuapp.com';
            wss.accessToken = 'replace with token or authentication mechanism';
            wss.userId = UserInfo.getUserId();
            return wss;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled(cacheable=true)
    public static void publishEvent(String evt){
        try {
            Open_Record__e openRecord = new Open_Record__e(
                Record_Id__c = 'testaasdad',
                User_Id__c = UserInfo.getUserId()
            );

            String serialized = JSON.serialize(openRecord);
            System.debug(serialized);

            SObject e = (SObject)JSON.deserialize(evt, SObject.class);
            EventBus.publish(e);
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    private static String requestAccessToken() {
        HttpRequest req = new HttpRequest();
        req.setEndpoint(REQUEST_ACCESS_TOKEN_URL);
        req.setMethod('POST');
        Http websocketServer = new Http();
        HttpResponse res = websocketServer.send(req);
        return res.getBody();
    }

    public class WebSocketConnection {
        @AuraEnabled
        public string accessToken {get; set;}
        @AuraEnabled
        public string url;
        @AuraEnabled
        public string userId;
    }
}