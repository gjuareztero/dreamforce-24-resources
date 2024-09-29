public without sharing class OnlineUsersController {
    @AuraEnabled(Cacheable=true)
    public static List<User> getUsers(List<String> userIds) {
        if (userIds != null && userIds.size() > 0 && User.SObjectType.getDescribe().isAccessible()) {
            return [
                SELECT Id, Name, FirstName, LastName, SmallPhotoUrl, Initials__c
                FROM User
                WHERE Id IN :userIds
            ];
        }
        return new List<User>();
    }

    @AuraEnabled
    public static void publishOpenRecordEvent(String recordId) {
        try {
            EventBus.publish(new Open_Record__e(Record_Id__c = recordId, User_Id__c = UserInfo.getUserId()));
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static void publishCloseRecordEvent(String recordId) {
        try {
            EventBus.publish(new Close_Record__e(Record_Id__c = recordId, User_Id__c = UserInfo.getUserId()));
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }
}
