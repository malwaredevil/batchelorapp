import type { QueryKey, UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import type { AuthProviders, AuthUser, ChangePasswordInput, CompareFabricBody, DeletePotteryUnusedCategories200, DeleteQuiltingUnusedCategories200, Error, ForgotPasswordInput, HealthStatus, ImportPatternFromUrlBody, ListFabricsParams, ListPatternsParams, ListPotteryParams, ListQuiltsParams, LoginInput, MergeQuiltingCategory200, PaletteMatchFabricsBody, PaletteMatchPatternsBody, PaletteMatchQuiltsBody, PotteryCategory, PotteryCategoryColorInput, PotteryCategoryInput, PotteryCollectionStats, PotteryCompareResult, PotteryMergeCategoryInput, PotteryPotteryBulkReanalyzeInput, PotteryPotteryBulkReanalyzeResult, PotteryPotteryImage, PotteryPotteryImageUpdate, PotteryPotteryItem, PotteryPotteryListResponse, PotteryPotteryUpdate, PotteryPrimaryImageSelection, PotteryStragglers, QuiltingAddImageInput, QuiltingBlock, QuiltingBlockTemplate, QuiltingBulkReanalyzeInput, QuiltingBulkReanalyzeResult, QuiltingCategoryWithCount, QuiltingCollectionStats, QuiltingCompareResult, QuiltingCreateBlockInput, QuiltingCreateBlockTemplateInput, QuiltingCreateCategoryInput, QuiltingCreateFabricInput, QuiltingCreateLayoutInput, QuiltingCreatePatternInput, QuiltingCreateQuiltInput, QuiltingCreateShoppingItemInput, QuiltingDetectSeamsInput, QuiltingDetectedSeams, QuiltingEntityImage, QuiltingExtractBlocksResult, QuiltingFabric, QuiltingFabricsListResponse, QuiltingFinishedQuilt, QuiltingImportedPatternInfo, QuiltingMergeCategoryInput, QuiltingPaletteMatchFabricResponse, QuiltingPaletteMatchPatternResponse, QuiltingPaletteMatchQuiltResponse, QuiltingPatternsListResponse, QuiltingQuiltLayout, QuiltingQuiltPattern, QuiltingQuiltsListResponse, QuiltingRenameCategoryInput, QuiltingShoppingItem, QuiltingShoppingStats, QuiltingStaleCount, QuiltingUpdateBlockInput, QuiltingUpdateBlockTemplateInput, QuiltingUpdateCategoryColorsInput, QuiltingUpdateFabricInput, QuiltingUpdateImageInput, QuiltingUpdateLayoutInput, QuiltingUpdatePatternInput, QuiltingUpdateQuiltInput, QuiltingUpdateShoppingItemInput, ReorderPackingItems200, ResetPasswordInput, SendPhoneCodeInput, TravelsBulkCreatePackingItemsBody, TravelsCreatePackingItemBody, TravelsCreatePackingTemplateBody, TravelsCreateTripBody, TravelsExploreDestinationBody, TravelsExploreDestinationResult, TravelsGenerateItineraryBody, TravelsItineraryResult, TravelsListDocumentsResponse, TravelsListTripsResponse, TravelsLoadTemplateResult, TravelsPackingItem, TravelsPackingListWithItems, TravelsPackingTemplate, TravelsReorderPackingItemsBody, TravelsTravelsStatsResponse, TravelsTrip, TravelsTripDetail, TravelsTripDocument, TravelsUpdatePackingItemBody, TravelsUpdateTripBody, UpdateAccountInput, UpdateTripDocumentBody, UploadTripDocumentBody, VerifyPhoneCodeInput } from './api.schemas';
import { customFetch } from '../custom-fetch';
import type { ErrorType, BodyType } from '../custom-fetch';
type AwaitedInput<T> = PromiseLike<T> | T;
type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];
export declare const getHealthCheckUrl: () => string;
/**
 * @summary Health check
 */
export declare const healthCheck: (options?: RequestInit) => Promise<HealthStatus>;
export declare const getHealthCheckQueryKey: () => readonly ["/api/healthz"];
export declare const getHealthCheckQueryOptions: <TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData> & {
    queryKey: QueryKey;
};
export type HealthCheckQueryResult = NonNullable<Awaited<ReturnType<typeof healthCheck>>>;
export type HealthCheckQueryError = ErrorType<unknown>;
/**
 * @summary Health check
 */
export declare function useHealthCheck<TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getLoginUrl: () => string;
/**
 * @summary Log in
 */
export declare const login: (loginInput: LoginInput, options?: RequestInit) => Promise<AuthUser>;
export declare const getLoginMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof login>>, TError, {
        data: BodyType<LoginInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof login>>, TError, {
    data: BodyType<LoginInput>;
}, TContext>;
export type LoginMutationResult = NonNullable<Awaited<ReturnType<typeof login>>>;
export type LoginMutationBody = BodyType<LoginInput>;
export type LoginMutationError = ErrorType<Error>;
/**
* @summary Log in
*/
export declare const useLogin: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof login>>, TError, {
        data: BodyType<LoginInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof login>>, TError, {
    data: BodyType<LoginInput>;
}, TContext>;
export declare const getLogoutUrl: () => string;
/**
 * @summary Log out
 */
export declare const logout: (options?: RequestInit) => Promise<void>;
export declare const getLogoutMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof logout>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof logout>>, TError, void, TContext>;
export type LogoutMutationResult = NonNullable<Awaited<ReturnType<typeof logout>>>;
export type LogoutMutationError = ErrorType<unknown>;
/**
* @summary Log out
*/
export declare const useLogout: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof logout>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof logout>>, TError, void, TContext>;
export declare const getGetCurrentUserUrl: () => string;
/**
 * @summary Get current user
 */
export declare const getCurrentUser: (options?: RequestInit) => Promise<AuthUser>;
export declare const getGetCurrentUserQueryKey: () => readonly ["/api/auth/me"];
export declare const getGetCurrentUserQueryOptions: <TData = Awaited<ReturnType<typeof getCurrentUser>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getCurrentUser>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getCurrentUser>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetCurrentUserQueryResult = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
export type GetCurrentUserQueryError = ErrorType<void>;
/**
 * @summary Get current user
 */
export declare function useGetCurrentUser<TData = Awaited<ReturnType<typeof getCurrentUser>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getCurrentUser>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateCurrentUserUrl: () => string;
/**
 * @summary Update the current user's account settings
 */
export declare const updateCurrentUser: (updateAccountInput: UpdateAccountInput, options?: RequestInit) => Promise<AuthUser>;
export declare const getUpdateCurrentUserMutationOptions: <TError = ErrorType<Error | void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateCurrentUser>>, TError, {
        data: BodyType<UpdateAccountInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateCurrentUser>>, TError, {
    data: BodyType<UpdateAccountInput>;
}, TContext>;
export type UpdateCurrentUserMutationResult = NonNullable<Awaited<ReturnType<typeof updateCurrentUser>>>;
export type UpdateCurrentUserMutationBody = BodyType<UpdateAccountInput>;
export type UpdateCurrentUserMutationError = ErrorType<Error | void>;
/**
* @summary Update the current user's account settings
*/
export declare const useUpdateCurrentUser: <TError = ErrorType<Error | void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateCurrentUser>>, TError, {
        data: BodyType<UpdateAccountInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateCurrentUser>>, TError, {
    data: BodyType<UpdateAccountInput>;
}, TContext>;
export declare const getGetAuthProvidersUrl: () => string;
/**
 * @summary Get available login providers
 */
export declare const getAuthProviders: (options?: RequestInit) => Promise<AuthProviders>;
export declare const getGetAuthProvidersQueryKey: () => readonly ["/api/auth/providers"];
export declare const getGetAuthProvidersQueryOptions: <TData = Awaited<ReturnType<typeof getAuthProviders>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAuthProviders>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getAuthProviders>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetAuthProvidersQueryResult = NonNullable<Awaited<ReturnType<typeof getAuthProviders>>>;
export type GetAuthProvidersQueryError = ErrorType<unknown>;
/**
 * @summary Get available login providers
 */
export declare function useGetAuthProviders<TData = Awaited<ReturnType<typeof getAuthProviders>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAuthProviders>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getForgotPasswordUrl: () => string;
/**
 * @summary Request a password reset email
 */
export declare const forgotPassword: (forgotPasswordInput: ForgotPasswordInput, options?: RequestInit) => Promise<void>;
export declare const getForgotPasswordMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof forgotPassword>>, TError, {
        data: BodyType<ForgotPasswordInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof forgotPassword>>, TError, {
    data: BodyType<ForgotPasswordInput>;
}, TContext>;
export type ForgotPasswordMutationResult = NonNullable<Awaited<ReturnType<typeof forgotPassword>>>;
export type ForgotPasswordMutationBody = BodyType<ForgotPasswordInput>;
export type ForgotPasswordMutationError = ErrorType<Error>;
/**
* @summary Request a password reset email
*/
export declare const useForgotPassword: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof forgotPassword>>, TError, {
        data: BodyType<ForgotPasswordInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof forgotPassword>>, TError, {
    data: BodyType<ForgotPasswordInput>;
}, TContext>;
export declare const getResetPasswordUrl: () => string;
/**
 * @summary Consume a reset token and set a new password
 */
export declare const resetPassword: (resetPasswordInput: ResetPasswordInput, options?: RequestInit) => Promise<void>;
export declare const getResetPasswordMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof resetPassword>>, TError, {
        data: BodyType<ResetPasswordInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof resetPassword>>, TError, {
    data: BodyType<ResetPasswordInput>;
}, TContext>;
export type ResetPasswordMutationResult = NonNullable<Awaited<ReturnType<typeof resetPassword>>>;
export type ResetPasswordMutationBody = BodyType<ResetPasswordInput>;
export type ResetPasswordMutationError = ErrorType<Error>;
/**
* @summary Consume a reset token and set a new password
*/
export declare const useResetPassword: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof resetPassword>>, TError, {
        data: BodyType<ResetPasswordInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof resetPassword>>, TError, {
    data: BodyType<ResetPasswordInput>;
}, TContext>;
export declare const getSendPhoneVerificationCodeUrl: () => string;
/**
 * @summary Send a one-time SMS verification code to a candidate phone number
 */
export declare const sendPhoneVerificationCode: (sendPhoneCodeInput: SendPhoneCodeInput, options?: RequestInit) => Promise<void>;
export declare const getSendPhoneVerificationCodeMutationOptions: <TError = ErrorType<Error | void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof sendPhoneVerificationCode>>, TError, {
        data: BodyType<SendPhoneCodeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof sendPhoneVerificationCode>>, TError, {
    data: BodyType<SendPhoneCodeInput>;
}, TContext>;
export type SendPhoneVerificationCodeMutationResult = NonNullable<Awaited<ReturnType<typeof sendPhoneVerificationCode>>>;
export type SendPhoneVerificationCodeMutationBody = BodyType<SendPhoneCodeInput>;
export type SendPhoneVerificationCodeMutationError = ErrorType<Error | void>;
/**
* @summary Send a one-time SMS verification code to a candidate phone number
*/
export declare const useSendPhoneVerificationCode: <TError = ErrorType<Error | void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof sendPhoneVerificationCode>>, TError, {
        data: BodyType<SendPhoneCodeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof sendPhoneVerificationCode>>, TError, {
    data: BodyType<SendPhoneCodeInput>;
}, TContext>;
export declare const getVerifyPhoneCodeUrl: () => string;
/**
 * @summary Verify a one-time code and commit the phone number to the account
 */
export declare const verifyPhoneCode: (verifyPhoneCodeInput: VerifyPhoneCodeInput, options?: RequestInit) => Promise<AuthUser>;
export declare const getVerifyPhoneCodeMutationOptions: <TError = ErrorType<Error | void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof verifyPhoneCode>>, TError, {
        data: BodyType<VerifyPhoneCodeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof verifyPhoneCode>>, TError, {
    data: BodyType<VerifyPhoneCodeInput>;
}, TContext>;
export type VerifyPhoneCodeMutationResult = NonNullable<Awaited<ReturnType<typeof verifyPhoneCode>>>;
export type VerifyPhoneCodeMutationBody = BodyType<VerifyPhoneCodeInput>;
export type VerifyPhoneCodeMutationError = ErrorType<Error | void>;
/**
* @summary Verify a one-time code and commit the phone number to the account
*/
export declare const useVerifyPhoneCode: <TError = ErrorType<Error | void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof verifyPhoneCode>>, TError, {
        data: BodyType<VerifyPhoneCodeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof verifyPhoneCode>>, TError, {
    data: BodyType<VerifyPhoneCodeInput>;
}, TContext>;
export declare const getSendTestSmsUrl: () => string;
/**
 * @summary Send a test SMS to the current user's own verified phone number
 */
export declare const sendTestSms: (options?: RequestInit) => Promise<void>;
export declare const getSendTestSmsMutationOptions: <TError = ErrorType<Error | void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof sendTestSms>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof sendTestSms>>, TError, void, TContext>;
export type SendTestSmsMutationResult = NonNullable<Awaited<ReturnType<typeof sendTestSms>>>;
export type SendTestSmsMutationError = ErrorType<Error | void>;
/**
* @summary Send a test SMS to the current user's own verified phone number
*/
export declare const useSendTestSms: <TError = ErrorType<Error | void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof sendTestSms>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof sendTestSms>>, TError, void, TContext>;
export declare const getSendTestEmailUrl: () => string;
/**
 * @summary Send a test email to the current user's own account email
 */
export declare const sendTestEmail: (options?: RequestInit) => Promise<void>;
export declare const getSendTestEmailMutationOptions: <TError = ErrorType<void | Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof sendTestEmail>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof sendTestEmail>>, TError, void, TContext>;
export type SendTestEmailMutationResult = NonNullable<Awaited<ReturnType<typeof sendTestEmail>>>;
export type SendTestEmailMutationError = ErrorType<void | Error>;
/**
* @summary Send a test email to the current user's own account email
*/
export declare const useSendTestEmail: <TError = ErrorType<void | Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof sendTestEmail>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof sendTestEmail>>, TError, void, TContext>;
export declare const getChangePasswordUrl: () => string;
/**
 * @summary Change password for the current user
 */
export declare const changePassword: (changePasswordInput: ChangePasswordInput, options?: RequestInit) => Promise<void>;
export declare const getChangePasswordMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof changePassword>>, TError, {
        data: BodyType<ChangePasswordInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof changePassword>>, TError, {
    data: BodyType<ChangePasswordInput>;
}, TContext>;
export type ChangePasswordMutationResult = NonNullable<Awaited<ReturnType<typeof changePassword>>>;
export type ChangePasswordMutationBody = BodyType<ChangePasswordInput>;
export type ChangePasswordMutationError = ErrorType<Error>;
/**
* @summary Change password for the current user
*/
export declare const useChangePassword: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof changePassword>>, TError, {
        data: BodyType<ChangePasswordInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof changePassword>>, TError, {
    data: BodyType<ChangePasswordInput>;
}, TContext>;
export declare const getListPotteryUrl: (params?: ListPotteryParams) => string;
/**
 * @summary List pottery
 */
export declare const listPottery: (params?: ListPotteryParams, options?: RequestInit) => Promise<PotteryPotteryListResponse>;
export declare const getListPotteryQueryKey: (params?: ListPotteryParams) => readonly ["/api/pottery/items", ...ListPotteryParams[]];
export declare const getListPotteryQueryOptions: <TData = Awaited<ReturnType<typeof listPottery>>, TError = ErrorType<unknown>>(params?: ListPotteryParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listPottery>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listPottery>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListPotteryQueryResult = NonNullable<Awaited<ReturnType<typeof listPottery>>>;
export type ListPotteryQueryError = ErrorType<unknown>;
/**
 * @summary List pottery
 */
export declare function useListPottery<TData = Awaited<ReturnType<typeof listPottery>>, TError = ErrorType<unknown>>(params?: ListPotteryParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listPottery>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreatePotteryUrl: () => string;
/**
 * @summary Add a pottery piece
 */
export declare const createPottery: (options?: RequestInit) => Promise<PotteryPotteryItem>;
export declare const getCreatePotteryMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createPottery>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createPottery>>, TError, void, TContext>;
export type CreatePotteryMutationResult = NonNullable<Awaited<ReturnType<typeof createPottery>>>;
export type CreatePotteryMutationError = ErrorType<Error>;
/**
* @summary Add a pottery piece
*/
export declare const useCreatePottery: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createPottery>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createPottery>>, TError, void, TContext>;
export declare const getGetStragglersUrl: () => string;
/**
 * Returns pieces that need re-analysis: those with no similarity embedding (invisible to the "Do I own this?" compare) or with no descriptive attributes at all. Used by the Maintenance page to offer a one-click targeted re-analysis.
 * @summary List pieces missing an embedding or core attributes
 */
export declare const getStragglers: (options?: RequestInit) => Promise<PotteryStragglers>;
export declare const getGetStragglersQueryKey: () => readonly ["/api/pottery/items/stragglers"];
export declare const getGetStragglersQueryOptions: <TData = Awaited<ReturnType<typeof getStragglers>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getStragglers>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getStragglers>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetStragglersQueryResult = NonNullable<Awaited<ReturnType<typeof getStragglers>>>;
export type GetStragglersQueryError = ErrorType<unknown>;
/**
 * @summary List pieces missing an embedding or core attributes
 */
export declare function useGetStragglers<TData = Awaited<ReturnType<typeof getStragglers>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getStragglers>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetPotteryUrl: (id: number) => string;
/**
 * @summary Get a pottery piece
 */
export declare const getPottery: (id: number, options?: RequestInit) => Promise<PotteryPotteryItem>;
export declare const getGetPotteryQueryKey: (id: number) => readonly [`/api/pottery/items/${number}`];
export declare const getGetPotteryQueryOptions: <TData = Awaited<ReturnType<typeof getPottery>>, TError = ErrorType<Error>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPottery>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getPottery>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetPotteryQueryResult = NonNullable<Awaited<ReturnType<typeof getPottery>>>;
export type GetPotteryQueryError = ErrorType<Error>;
/**
 * @summary Get a pottery piece
 */
export declare function useGetPottery<TData = Awaited<ReturnType<typeof getPottery>>, TError = ErrorType<Error>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPottery>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdatePotteryUrl: (id: number) => string;
/**
 * @summary Update a pottery piece
 */
export declare const updatePottery: (id: number, potteryPotteryUpdate: PotteryPotteryUpdate, options?: RequestInit) => Promise<PotteryPotteryItem>;
export declare const getUpdatePotteryMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updatePottery>>, TError, {
        id: number;
        data: BodyType<PotteryPotteryUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updatePottery>>, TError, {
    id: number;
    data: BodyType<PotteryPotteryUpdate>;
}, TContext>;
export type UpdatePotteryMutationResult = NonNullable<Awaited<ReturnType<typeof updatePottery>>>;
export type UpdatePotteryMutationBody = BodyType<PotteryPotteryUpdate>;
export type UpdatePotteryMutationError = ErrorType<Error>;
/**
* @summary Update a pottery piece
*/
export declare const useUpdatePottery: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updatePottery>>, TError, {
        id: number;
        data: BodyType<PotteryPotteryUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updatePottery>>, TError, {
    id: number;
    data: BodyType<PotteryPotteryUpdate>;
}, TContext>;
export declare const getDeletePotteryUrl: (id: number) => string;
/**
 * @summary Remove a pottery piece
 */
export declare const deletePottery: (id: number, options?: RequestInit) => Promise<void>;
export declare const getDeletePotteryMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deletePottery>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deletePottery>>, TError, {
    id: number;
}, TContext>;
export type DeletePotteryMutationResult = NonNullable<Awaited<ReturnType<typeof deletePottery>>>;
export type DeletePotteryMutationError = ErrorType<Error>;
/**
* @summary Remove a pottery piece
*/
export declare const useDeletePottery: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deletePottery>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deletePottery>>, TError, {
    id: number;
}, TContext>;
export declare const getAddPotteryImageUrl: (id: number) => string;
/**
 * @summary Add a supplemental image to a piece
 */
export declare const addPotteryImage: (id: number, options?: RequestInit) => Promise<PotteryPotteryImage>;
export declare const getAddPotteryImageMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof addPotteryImage>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof addPotteryImage>>, TError, {
    id: number;
}, TContext>;
export type AddPotteryImageMutationResult = NonNullable<Awaited<ReturnType<typeof addPotteryImage>>>;
export type AddPotteryImageMutationError = ErrorType<Error>;
/**
* @summary Add a supplemental image to a piece
*/
export declare const useAddPotteryImage: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof addPotteryImage>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof addPotteryImage>>, TError, {
    id: number;
}, TContext>;
export declare const getUpdatePotteryImageUrl: (id: number, imageId: number) => string;
/**
 * @summary Update a supplemental image's label or position
 */
export declare const updatePotteryImage: (id: number, imageId: number, potteryPotteryImageUpdate: PotteryPotteryImageUpdate, options?: RequestInit) => Promise<PotteryPotteryImage>;
export declare const getUpdatePotteryImageMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updatePotteryImage>>, TError, {
        id: number;
        imageId: number;
        data: BodyType<PotteryPotteryImageUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updatePotteryImage>>, TError, {
    id: number;
    imageId: number;
    data: BodyType<PotteryPotteryImageUpdate>;
}, TContext>;
export type UpdatePotteryImageMutationResult = NonNullable<Awaited<ReturnType<typeof updatePotteryImage>>>;
export type UpdatePotteryImageMutationBody = BodyType<PotteryPotteryImageUpdate>;
export type UpdatePotteryImageMutationError = ErrorType<Error>;
/**
* @summary Update a supplemental image's label or position
*/
export declare const useUpdatePotteryImage: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updatePotteryImage>>, TError, {
        id: number;
        imageId: number;
        data: BodyType<PotteryPotteryImageUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updatePotteryImage>>, TError, {
    id: number;
    imageId: number;
    data: BodyType<PotteryPotteryImageUpdate>;
}, TContext>;
export declare const getDeletePotteryImageUrl: (id: number, imageId: number) => string;
/**
 * @summary Remove a supplemental image
 */
export declare const deletePotteryImage: (id: number, imageId: number, options?: RequestInit) => Promise<void>;
export declare const getDeletePotteryImageMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deletePotteryImage>>, TError, {
        id: number;
        imageId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deletePotteryImage>>, TError, {
    id: number;
    imageId: number;
}, TContext>;
export type DeletePotteryImageMutationResult = NonNullable<Awaited<ReturnType<typeof deletePotteryImage>>>;
export type DeletePotteryImageMutationError = ErrorType<Error>;
/**
* @summary Remove a supplemental image
*/
export declare const useDeletePotteryImage: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deletePotteryImage>>, TError, {
        id: number;
        imageId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deletePotteryImage>>, TError, {
    id: number;
    imageId: number;
}, TContext>;
export declare const getReanalyzePotteryUrl: (id: number) => string;
/**
 * @summary Re-run AI analysis on a pottery piece
 */
export declare const reanalyzePottery: (id: number, options?: RequestInit) => Promise<PotteryPotteryItem>;
export declare const getReanalyzePotteryMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof reanalyzePottery>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof reanalyzePottery>>, TError, {
    id: number;
}, TContext>;
export type ReanalyzePotteryMutationResult = NonNullable<Awaited<ReturnType<typeof reanalyzePottery>>>;
export type ReanalyzePotteryMutationError = ErrorType<Error>;
/**
* @summary Re-run AI analysis on a pottery piece
*/
export declare const useReanalyzePottery: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof reanalyzePottery>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof reanalyzePottery>>, TError, {
    id: number;
}, TContext>;
export declare const getBulkReanalyzePotteryUrl: () => string;
/**
 * @summary Re-run AI analysis on multiple pottery pieces
 */
export declare const bulkReanalyzePottery: (potteryPotteryBulkReanalyzeInput: PotteryPotteryBulkReanalyzeInput, options?: RequestInit) => Promise<PotteryPotteryBulkReanalyzeResult>;
export declare const getBulkReanalyzePotteryMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof bulkReanalyzePottery>>, TError, {
        data: BodyType<PotteryPotteryBulkReanalyzeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof bulkReanalyzePottery>>, TError, {
    data: BodyType<PotteryPotteryBulkReanalyzeInput>;
}, TContext>;
export type BulkReanalyzePotteryMutationResult = NonNullable<Awaited<ReturnType<typeof bulkReanalyzePottery>>>;
export type BulkReanalyzePotteryMutationBody = BodyType<PotteryPotteryBulkReanalyzeInput>;
export type BulkReanalyzePotteryMutationError = ErrorType<unknown>;
/**
* @summary Re-run AI analysis on multiple pottery pieces
*/
export declare const useBulkReanalyzePottery: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof bulkReanalyzePottery>>, TError, {
        data: BodyType<PotteryPotteryBulkReanalyzeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof bulkReanalyzePottery>>, TError, {
    data: BodyType<PotteryPotteryBulkReanalyzeInput>;
}, TContext>;
export declare const getSetPrimaryImageUrl: (id: number) => string;
/**
 * @summary Promote a supplemental image to primary and re-analyse
 */
export declare const setPrimaryImage: (id: number, potteryPrimaryImageSelection: PotteryPrimaryImageSelection, options?: RequestInit) => Promise<PotteryPotteryItem>;
export declare const getSetPrimaryImageMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof setPrimaryImage>>, TError, {
        id: number;
        data: BodyType<PotteryPrimaryImageSelection>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof setPrimaryImage>>, TError, {
    id: number;
    data: BodyType<PotteryPrimaryImageSelection>;
}, TContext>;
export type SetPrimaryImageMutationResult = NonNullable<Awaited<ReturnType<typeof setPrimaryImage>>>;
export type SetPrimaryImageMutationBody = BodyType<PotteryPrimaryImageSelection>;
export type SetPrimaryImageMutationError = ErrorType<Error>;
/**
* @summary Promote a supplemental image to primary and re-analyse
*/
export declare const useSetPrimaryImage: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof setPrimaryImage>>, TError, {
        id: number;
        data: BodyType<PotteryPrimaryImageSelection>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof setPrimaryImage>>, TError, {
    id: number;
    data: BodyType<PotteryPrimaryImageSelection>;
}, TContext>;
export declare const getListPotteryCategoriesUrl: () => string;
/**
 * @summary List categories
 */
export declare const listPotteryCategories: (options?: RequestInit) => Promise<PotteryCategory[]>;
export declare const getListPotteryCategoriesQueryKey: () => readonly ["/api/pottery/categories"];
export declare const getListPotteryCategoriesQueryOptions: <TData = Awaited<ReturnType<typeof listPotteryCategories>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listPotteryCategories>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listPotteryCategories>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListPotteryCategoriesQueryResult = NonNullable<Awaited<ReturnType<typeof listPotteryCategories>>>;
export type ListPotteryCategoriesQueryError = ErrorType<unknown>;
/**
 * @summary List categories
 */
export declare function useListPotteryCategories<TData = Awaited<ReturnType<typeof listPotteryCategories>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listPotteryCategories>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreatePotteryCategoryUrl: () => string;
/**
 * @summary Create a category
 */
export declare const createPotteryCategory: (potteryCategoryInput: PotteryCategoryInput, options?: RequestInit) => Promise<PotteryCategory>;
export declare const getCreatePotteryCategoryMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createPotteryCategory>>, TError, {
        data: BodyType<PotteryCategoryInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createPotteryCategory>>, TError, {
    data: BodyType<PotteryCategoryInput>;
}, TContext>;
export type CreatePotteryCategoryMutationResult = NonNullable<Awaited<ReturnType<typeof createPotteryCategory>>>;
export type CreatePotteryCategoryMutationBody = BodyType<PotteryCategoryInput>;
export type CreatePotteryCategoryMutationError = ErrorType<Error>;
/**
* @summary Create a category
*/
export declare const useCreatePotteryCategory: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createPotteryCategory>>, TError, {
        data: BodyType<PotteryCategoryInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createPotteryCategory>>, TError, {
    data: BodyType<PotteryCategoryInput>;
}, TContext>;
export declare const getDeletePotteryUnusedCategoriesUrl: () => string;
/**
 * @summary Delete all categories that have no pieces assigned
 */
export declare const deletePotteryUnusedCategories: (options?: RequestInit) => Promise<DeletePotteryUnusedCategories200>;
export declare const getDeletePotteryUnusedCategoriesMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deletePotteryUnusedCategories>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deletePotteryUnusedCategories>>, TError, void, TContext>;
export type DeletePotteryUnusedCategoriesMutationResult = NonNullable<Awaited<ReturnType<typeof deletePotteryUnusedCategories>>>;
export type DeletePotteryUnusedCategoriesMutationError = ErrorType<unknown>;
/**
* @summary Delete all categories that have no pieces assigned
*/
export declare const useDeletePotteryUnusedCategories: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deletePotteryUnusedCategories>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deletePotteryUnusedCategories>>, TError, void, TContext>;
export declare const getRenamePotteryCategoryUrl: (id: number) => string;
/**
 * @summary Rename a category
 */
export declare const renamePotteryCategory: (id: number, potteryCategoryInput: PotteryCategoryInput, options?: RequestInit) => Promise<PotteryCategory>;
export declare const getRenamePotteryCategoryMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof renamePotteryCategory>>, TError, {
        id: number;
        data: BodyType<PotteryCategoryInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof renamePotteryCategory>>, TError, {
    id: number;
    data: BodyType<PotteryCategoryInput>;
}, TContext>;
export type RenamePotteryCategoryMutationResult = NonNullable<Awaited<ReturnType<typeof renamePotteryCategory>>>;
export type RenamePotteryCategoryMutationBody = BodyType<PotteryCategoryInput>;
export type RenamePotteryCategoryMutationError = ErrorType<Error>;
/**
* @summary Rename a category
*/
export declare const useRenamePotteryCategory: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof renamePotteryCategory>>, TError, {
        id: number;
        data: BodyType<PotteryCategoryInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof renamePotteryCategory>>, TError, {
    id: number;
    data: BodyType<PotteryCategoryInput>;
}, TContext>;
export declare const getDeletePotteryCategoryUrl: (id: number) => string;
/**
 * @summary Delete a category
 */
export declare const deletePotteryCategory: (id: number, options?: RequestInit) => Promise<void>;
export declare const getDeletePotteryCategoryMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deletePotteryCategory>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deletePotteryCategory>>, TError, {
    id: number;
}, TContext>;
export type DeletePotteryCategoryMutationResult = NonNullable<Awaited<ReturnType<typeof deletePotteryCategory>>>;
export type DeletePotteryCategoryMutationError = ErrorType<Error>;
/**
* @summary Delete a category
*/
export declare const useDeletePotteryCategory: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deletePotteryCategory>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deletePotteryCategory>>, TError, {
    id: number;
}, TContext>;
export declare const getUpdatePotteryCategoryColorsUrl: (id: number) => string;
/**
 * @summary Update a category's background and text colours
 */
export declare const updatePotteryCategoryColors: (id: number, potteryCategoryColorInput: PotteryCategoryColorInput, options?: RequestInit) => Promise<PotteryCategory>;
export declare const getUpdatePotteryCategoryColorsMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updatePotteryCategoryColors>>, TError, {
        id: number;
        data: BodyType<PotteryCategoryColorInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updatePotteryCategoryColors>>, TError, {
    id: number;
    data: BodyType<PotteryCategoryColorInput>;
}, TContext>;
export type UpdatePotteryCategoryColorsMutationResult = NonNullable<Awaited<ReturnType<typeof updatePotteryCategoryColors>>>;
export type UpdatePotteryCategoryColorsMutationBody = BodyType<PotteryCategoryColorInput>;
export type UpdatePotteryCategoryColorsMutationError = ErrorType<Error>;
/**
* @summary Update a category's background and text colours
*/
export declare const useUpdatePotteryCategoryColors: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updatePotteryCategoryColors>>, TError, {
        id: number;
        data: BodyType<PotteryCategoryColorInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updatePotteryCategoryColors>>, TError, {
    id: number;
    data: BodyType<PotteryCategoryColorInput>;
}, TContext>;
export declare const getMergePotteryCategoryUrl: (id: number) => string;
/**
 * @summary Merge a category into another (reassigns all pieces, deletes source)
 */
export declare const mergePotteryCategory: (id: number, potteryMergeCategoryInput: PotteryMergeCategoryInput, options?: RequestInit) => Promise<void>;
export declare const getMergePotteryCategoryMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof mergePotteryCategory>>, TError, {
        id: number;
        data: BodyType<PotteryMergeCategoryInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof mergePotteryCategory>>, TError, {
    id: number;
    data: BodyType<PotteryMergeCategoryInput>;
}, TContext>;
export type MergePotteryCategoryMutationResult = NonNullable<Awaited<ReturnType<typeof mergePotteryCategory>>>;
export type MergePotteryCategoryMutationBody = BodyType<PotteryMergeCategoryInput>;
export type MergePotteryCategoryMutationError = ErrorType<Error>;
/**
* @summary Merge a category into another (reassigns all pieces, deletes source)
*/
export declare const useMergePotteryCategory: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof mergePotteryCategory>>, TError, {
        id: number;
        data: BodyType<PotteryMergeCategoryInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof mergePotteryCategory>>, TError, {
    id: number;
    data: BodyType<PotteryMergeCategoryInput>;
}, TContext>;
export declare const getComparePotteryUrl: () => string;
/**
 * @summary Compare a candidate photo against the collection
 */
export declare const comparePottery: (options?: RequestInit) => Promise<PotteryCompareResult>;
export declare const getComparePotteryMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof comparePottery>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof comparePottery>>, TError, void, TContext>;
export type ComparePotteryMutationResult = NonNullable<Awaited<ReturnType<typeof comparePottery>>>;
export type ComparePotteryMutationError = ErrorType<Error>;
/**
* @summary Compare a candidate photo against the collection
*/
export declare const useComparePottery: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof comparePottery>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof comparePottery>>, TError, void, TContext>;
export declare const getGetCollectionStatsUrl: () => string;
/**
 * @summary Collection statistics
 */
export declare const getCollectionStats: (options?: RequestInit) => Promise<PotteryCollectionStats>;
export declare const getGetCollectionStatsQueryKey: () => readonly ["/api/pottery/stats"];
export declare const getGetCollectionStatsQueryOptions: <TData = Awaited<ReturnType<typeof getCollectionStats>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getCollectionStats>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getCollectionStats>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetCollectionStatsQueryResult = NonNullable<Awaited<ReturnType<typeof getCollectionStats>>>;
export type GetCollectionStatsQueryError = ErrorType<unknown>;
/**
 * @summary Collection statistics
 */
export declare function useGetCollectionStats<TData = Awaited<ReturnType<typeof getCollectionStats>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getCollectionStats>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getListFabricsUrl: (params?: ListFabricsParams) => string;
/**
 * @summary List all fabrics
 */
export declare const listFabrics: (params?: ListFabricsParams, options?: RequestInit) => Promise<QuiltingFabricsListResponse>;
export declare const getListFabricsQueryKey: (params?: ListFabricsParams) => readonly ["/api/quilting/fabrics", ...ListFabricsParams[]];
export declare const getListFabricsQueryOptions: <TData = Awaited<ReturnType<typeof listFabrics>>, TError = ErrorType<unknown>>(params?: ListFabricsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listFabrics>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listFabrics>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListFabricsQueryResult = NonNullable<Awaited<ReturnType<typeof listFabrics>>>;
export type ListFabricsQueryError = ErrorType<unknown>;
/**
 * @summary List all fabrics
 */
export declare function useListFabrics<TData = Awaited<ReturnType<typeof listFabrics>>, TError = ErrorType<unknown>>(params?: ListFabricsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listFabrics>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateFabricUrl: () => string;
/**
 * @summary Add a fabric (with primary photo)
 */
export declare const createFabric: (quiltingCreateFabricInput: QuiltingCreateFabricInput, options?: RequestInit) => Promise<QuiltingFabric>;
export declare const getCreateFabricMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createFabric>>, TError, {
        data: BodyType<QuiltingCreateFabricInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createFabric>>, TError, {
    data: BodyType<QuiltingCreateFabricInput>;
}, TContext>;
export type CreateFabricMutationResult = NonNullable<Awaited<ReturnType<typeof createFabric>>>;
export type CreateFabricMutationBody = BodyType<QuiltingCreateFabricInput>;
export type CreateFabricMutationError = ErrorType<Error>;
/**
* @summary Add a fabric (with primary photo)
*/
export declare const useCreateFabric: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createFabric>>, TError, {
        data: BodyType<QuiltingCreateFabricInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createFabric>>, TError, {
    data: BodyType<QuiltingCreateFabricInput>;
}, TContext>;
export declare const getGetFabricUrl: (id: number) => string;
/**
 * @summary Get a fabric by ID
 */
export declare const getFabric: (id: number, options?: RequestInit) => Promise<QuiltingFabric>;
export declare const getGetFabricQueryKey: (id: number) => readonly [`/api/quilting/fabrics/${number}`];
export declare const getGetFabricQueryOptions: <TData = Awaited<ReturnType<typeof getFabric>>, TError = ErrorType<Error>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getFabric>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getFabric>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetFabricQueryResult = NonNullable<Awaited<ReturnType<typeof getFabric>>>;
export type GetFabricQueryError = ErrorType<Error>;
/**
 * @summary Get a fabric by ID
 */
export declare function useGetFabric<TData = Awaited<ReturnType<typeof getFabric>>, TError = ErrorType<Error>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getFabric>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateFabricUrl: (id: number) => string;
/**
 * @summary Update fabric metadata
 */
export declare const updateFabric: (id: number, quiltingUpdateFabricInput: QuiltingUpdateFabricInput, options?: RequestInit) => Promise<QuiltingFabric>;
export declare const getUpdateFabricMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateFabric>>, TError, {
        id: number;
        data: BodyType<QuiltingUpdateFabricInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateFabric>>, TError, {
    id: number;
    data: BodyType<QuiltingUpdateFabricInput>;
}, TContext>;
export type UpdateFabricMutationResult = NonNullable<Awaited<ReturnType<typeof updateFabric>>>;
export type UpdateFabricMutationBody = BodyType<QuiltingUpdateFabricInput>;
export type UpdateFabricMutationError = ErrorType<Error>;
/**
* @summary Update fabric metadata
*/
export declare const useUpdateFabric: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateFabric>>, TError, {
        id: number;
        data: BodyType<QuiltingUpdateFabricInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateFabric>>, TError, {
    id: number;
    data: BodyType<QuiltingUpdateFabricInput>;
}, TContext>;
export declare const getDeleteFabricUrl: (id: number) => string;
/**
 * @summary Delete a fabric
 */
export declare const deleteFabric: (id: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteFabricMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteFabric>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteFabric>>, TError, {
    id: number;
}, TContext>;
export type DeleteFabricMutationResult = NonNullable<Awaited<ReturnType<typeof deleteFabric>>>;
export type DeleteFabricMutationError = ErrorType<unknown>;
/**
* @summary Delete a fabric
*/
export declare const useDeleteFabric: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteFabric>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteFabric>>, TError, {
    id: number;
}, TContext>;
export declare const getGetFabricImageUrl: (id: number) => string;
/**
 * @summary Get primary fabric image (proxied, authenticated)
 */
export declare const getFabricImage: (id: number, options?: RequestInit) => Promise<void>;
export declare const getGetFabricImageQueryKey: (id: number) => readonly [`/api/quilting/fabrics/${number}/image`];
export declare const getGetFabricImageQueryOptions: <TData = Awaited<ReturnType<typeof getFabricImage>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getFabricImage>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getFabricImage>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetFabricImageQueryResult = NonNullable<Awaited<ReturnType<typeof getFabricImage>>>;
export type GetFabricImageQueryError = ErrorType<unknown>;
/**
 * @summary Get primary fabric image (proxied, authenticated)
 */
export declare function useGetFabricImage<TData = Awaited<ReturnType<typeof getFabricImage>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getFabricImage>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getReanalyzeFabricUrl: (id: number) => string;
/**
 * @summary Re-run AI analysis on a fabric using its existing photos
 */
export declare const reanalyzeFabric: (id: number, options?: RequestInit) => Promise<QuiltingFabric>;
export declare const getReanalyzeFabricMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof reanalyzeFabric>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof reanalyzeFabric>>, TError, {
    id: number;
}, TContext>;
export type ReanalyzeFabricMutationResult = NonNullable<Awaited<ReturnType<typeof reanalyzeFabric>>>;
export type ReanalyzeFabricMutationError = ErrorType<unknown>;
/**
* @summary Re-run AI analysis on a fabric using its existing photos
*/
export declare const useReanalyzeFabric: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof reanalyzeFabric>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof reanalyzeFabric>>, TError, {
    id: number;
}, TContext>;
export declare const getGetFabricPairingsUrl: (id: number) => string;
/**
 * @summary Get up to 4 stash fabrics that pair well with this one (embedding similarity)
 */
export declare const getFabricPairings: (id: number, options?: RequestInit) => Promise<QuiltingFabric[]>;
export declare const getGetFabricPairingsQueryKey: (id: number) => readonly [`/api/quilting/fabrics/${number}/pairings`];
export declare const getGetFabricPairingsQueryOptions: <TData = Awaited<ReturnType<typeof getFabricPairings>>, TError = ErrorType<Error>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getFabricPairings>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getFabricPairings>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetFabricPairingsQueryResult = NonNullable<Awaited<ReturnType<typeof getFabricPairings>>>;
export type GetFabricPairingsQueryError = ErrorType<Error>;
/**
 * @summary Get up to 4 stash fabrics that pair well with this one (embedding similarity)
 */
export declare function useGetFabricPairings<TData = Awaited<ReturnType<typeof getFabricPairings>>, TError = ErrorType<Error>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getFabricPairings>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetUsedFabricIdsUrl: () => string;
/**
 * @summary Get IDs of fabrics linked to at least one finished quilt
 */
export declare const getUsedFabricIds: (options?: RequestInit) => Promise<number[]>;
export declare const getGetUsedFabricIdsQueryKey: () => readonly ["/api/quilting/fabrics/used-ids"];
export declare const getGetUsedFabricIdsQueryOptions: <TData = Awaited<ReturnType<typeof getUsedFabricIds>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getUsedFabricIds>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getUsedFabricIds>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetUsedFabricIdsQueryResult = NonNullable<Awaited<ReturnType<typeof getUsedFabricIds>>>;
export type GetUsedFabricIdsQueryError = ErrorType<unknown>;
/**
 * @summary Get IDs of fabrics linked to at least one finished quilt
 */
export declare function useGetUsedFabricIds<TData = Awaited<ReturnType<typeof getUsedFabricIds>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getUsedFabricIds>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getBulkReanalyzeFabricsUrl: () => string;
/**
 * @summary Re-run AI analysis on multiple fabrics
 */
export declare const bulkReanalyzeFabrics: (quiltingBulkReanalyzeInput: QuiltingBulkReanalyzeInput, options?: RequestInit) => Promise<QuiltingBulkReanalyzeResult>;
export declare const getBulkReanalyzeFabricsMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof bulkReanalyzeFabrics>>, TError, {
        data: BodyType<QuiltingBulkReanalyzeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof bulkReanalyzeFabrics>>, TError, {
    data: BodyType<QuiltingBulkReanalyzeInput>;
}, TContext>;
export type BulkReanalyzeFabricsMutationResult = NonNullable<Awaited<ReturnType<typeof bulkReanalyzeFabrics>>>;
export type BulkReanalyzeFabricsMutationBody = BodyType<QuiltingBulkReanalyzeInput>;
export type BulkReanalyzeFabricsMutationError = ErrorType<unknown>;
/**
* @summary Re-run AI analysis on multiple fabrics
*/
export declare const useBulkReanalyzeFabrics: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof bulkReanalyzeFabrics>>, TError, {
        data: BodyType<QuiltingBulkReanalyzeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof bulkReanalyzeFabrics>>, TError, {
    data: BodyType<QuiltingBulkReanalyzeInput>;
}, TContext>;
export declare const getAddFabricImageUrl: (id: number) => string;
/**
 * @summary Add a supplemental image to a fabric
 */
export declare const addFabricImage: (id: number, quiltingAddImageInput: QuiltingAddImageInput, options?: RequestInit) => Promise<QuiltingEntityImage>;
export declare const getAddFabricImageMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof addFabricImage>>, TError, {
        id: number;
        data: BodyType<QuiltingAddImageInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof addFabricImage>>, TError, {
    id: number;
    data: BodyType<QuiltingAddImageInput>;
}, TContext>;
export type AddFabricImageMutationResult = NonNullable<Awaited<ReturnType<typeof addFabricImage>>>;
export type AddFabricImageMutationBody = BodyType<QuiltingAddImageInput>;
export type AddFabricImageMutationError = ErrorType<unknown>;
/**
* @summary Add a supplemental image to a fabric
*/
export declare const useAddFabricImage: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof addFabricImage>>, TError, {
        id: number;
        data: BodyType<QuiltingAddImageInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof addFabricImage>>, TError, {
    id: number;
    data: BodyType<QuiltingAddImageInput>;
}, TContext>;
export declare const getGetFabricSupplementalImageUrl: (id: number, imageId: number) => string;
/**
 * @summary Get a supplemental fabric image
 */
export declare const getFabricSupplementalImage: (id: number, imageId: number, options?: RequestInit) => Promise<void>;
export declare const getGetFabricSupplementalImageQueryKey: (id: number, imageId: number) => readonly [`/api/quilting/fabrics/${number}/images/${number}`];
export declare const getGetFabricSupplementalImageQueryOptions: <TData = Awaited<ReturnType<typeof getFabricSupplementalImage>>, TError = ErrorType<unknown>>(id: number, imageId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getFabricSupplementalImage>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getFabricSupplementalImage>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetFabricSupplementalImageQueryResult = NonNullable<Awaited<ReturnType<typeof getFabricSupplementalImage>>>;
export type GetFabricSupplementalImageQueryError = ErrorType<unknown>;
/**
 * @summary Get a supplemental fabric image
 */
export declare function useGetFabricSupplementalImage<TData = Awaited<ReturnType<typeof getFabricSupplementalImage>>, TError = ErrorType<unknown>>(id: number, imageId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getFabricSupplementalImage>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateFabricImageUrl: (id: number, imageId: number) => string;
/**
 * @summary Update a supplemental fabric image label/position
 */
export declare const updateFabricImage: (id: number, imageId: number, quiltingUpdateImageInput: QuiltingUpdateImageInput, options?: RequestInit) => Promise<QuiltingEntityImage>;
export declare const getUpdateFabricImageMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateFabricImage>>, TError, {
        id: number;
        imageId: number;
        data: BodyType<QuiltingUpdateImageInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateFabricImage>>, TError, {
    id: number;
    imageId: number;
    data: BodyType<QuiltingUpdateImageInput>;
}, TContext>;
export type UpdateFabricImageMutationResult = NonNullable<Awaited<ReturnType<typeof updateFabricImage>>>;
export type UpdateFabricImageMutationBody = BodyType<QuiltingUpdateImageInput>;
export type UpdateFabricImageMutationError = ErrorType<unknown>;
/**
* @summary Update a supplemental fabric image label/position
*/
export declare const useUpdateFabricImage: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateFabricImage>>, TError, {
        id: number;
        imageId: number;
        data: BodyType<QuiltingUpdateImageInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateFabricImage>>, TError, {
    id: number;
    imageId: number;
    data: BodyType<QuiltingUpdateImageInput>;
}, TContext>;
export declare const getDeleteFabricImageUrl: (id: number, imageId: number) => string;
/**
 * @summary Delete a supplemental fabric image
 */
export declare const deleteFabricImage: (id: number, imageId: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteFabricImageMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteFabricImage>>, TError, {
        id: number;
        imageId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteFabricImage>>, TError, {
    id: number;
    imageId: number;
}, TContext>;
export type DeleteFabricImageMutationResult = NonNullable<Awaited<ReturnType<typeof deleteFabricImage>>>;
export type DeleteFabricImageMutationError = ErrorType<unknown>;
/**
* @summary Delete a supplemental fabric image
*/
export declare const useDeleteFabricImage: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteFabricImage>>, TError, {
        id: number;
        imageId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteFabricImage>>, TError, {
    id: number;
    imageId: number;
}, TContext>;
export declare const getListPatternsUrl: (params?: ListPatternsParams) => string;
/**
 * @summary List all quilt patterns
 */
export declare const listPatterns: (params?: ListPatternsParams, options?: RequestInit) => Promise<QuiltingPatternsListResponse>;
export declare const getListPatternsQueryKey: (params?: ListPatternsParams) => readonly ["/api/quilting/patterns", ...ListPatternsParams[]];
export declare const getListPatternsQueryOptions: <TData = Awaited<ReturnType<typeof listPatterns>>, TError = ErrorType<unknown>>(params?: ListPatternsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listPatterns>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listPatterns>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListPatternsQueryResult = NonNullable<Awaited<ReturnType<typeof listPatterns>>>;
export type ListPatternsQueryError = ErrorType<unknown>;
/**
 * @summary List all quilt patterns
 */
export declare function useListPatterns<TData = Awaited<ReturnType<typeof listPatterns>>, TError = ErrorType<unknown>>(params?: ListPatternsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listPatterns>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreatePatternUrl: () => string;
/**
 * @summary Add a quilt pattern
 */
export declare const createPattern: (quiltingCreatePatternInput: QuiltingCreatePatternInput, options?: RequestInit) => Promise<QuiltingQuiltPattern>;
export declare const getCreatePatternMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createPattern>>, TError, {
        data: BodyType<QuiltingCreatePatternInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createPattern>>, TError, {
    data: BodyType<QuiltingCreatePatternInput>;
}, TContext>;
export type CreatePatternMutationResult = NonNullable<Awaited<ReturnType<typeof createPattern>>>;
export type CreatePatternMutationBody = BodyType<QuiltingCreatePatternInput>;
export type CreatePatternMutationError = ErrorType<unknown>;
/**
* @summary Add a quilt pattern
*/
export declare const useCreatePattern: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createPattern>>, TError, {
        data: BodyType<QuiltingCreatePatternInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createPattern>>, TError, {
    data: BodyType<QuiltingCreatePatternInput>;
}, TContext>;
export declare const getGetPatternUrl: (id: number) => string;
/**
 * @summary Get a quilt pattern by ID
 */
export declare const getPattern: (id: number, options?: RequestInit) => Promise<QuiltingQuiltPattern>;
export declare const getGetPatternQueryKey: (id: number) => readonly [`/api/quilting/patterns/${number}`];
export declare const getGetPatternQueryOptions: <TData = Awaited<ReturnType<typeof getPattern>>, TError = ErrorType<Error>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPattern>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getPattern>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetPatternQueryResult = NonNullable<Awaited<ReturnType<typeof getPattern>>>;
export type GetPatternQueryError = ErrorType<Error>;
/**
 * @summary Get a quilt pattern by ID
 */
export declare function useGetPattern<TData = Awaited<ReturnType<typeof getPattern>>, TError = ErrorType<Error>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPattern>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdatePatternUrl: (id: number) => string;
/**
 * @summary Update pattern metadata
 */
export declare const updatePattern: (id: number, quiltingUpdatePatternInput: QuiltingUpdatePatternInput, options?: RequestInit) => Promise<QuiltingQuiltPattern>;
export declare const getUpdatePatternMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updatePattern>>, TError, {
        id: number;
        data: BodyType<QuiltingUpdatePatternInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updatePattern>>, TError, {
    id: number;
    data: BodyType<QuiltingUpdatePatternInput>;
}, TContext>;
export type UpdatePatternMutationResult = NonNullable<Awaited<ReturnType<typeof updatePattern>>>;
export type UpdatePatternMutationBody = BodyType<QuiltingUpdatePatternInput>;
export type UpdatePatternMutationError = ErrorType<unknown>;
/**
* @summary Update pattern metadata
*/
export declare const useUpdatePattern: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updatePattern>>, TError, {
        id: number;
        data: BodyType<QuiltingUpdatePatternInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updatePattern>>, TError, {
    id: number;
    data: BodyType<QuiltingUpdatePatternInput>;
}, TContext>;
export declare const getDeletePatternUrl: (id: number) => string;
/**
 * @summary Delete a pattern
 */
export declare const deletePattern: (id: number, options?: RequestInit) => Promise<void>;
export declare const getDeletePatternMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deletePattern>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deletePattern>>, TError, {
    id: number;
}, TContext>;
export type DeletePatternMutationResult = NonNullable<Awaited<ReturnType<typeof deletePattern>>>;
export type DeletePatternMutationError = ErrorType<unknown>;
/**
* @summary Delete a pattern
*/
export declare const useDeletePattern: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deletePattern>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deletePattern>>, TError, {
    id: number;
}, TContext>;
export declare const getGetPatternImageUrl: (id: number) => string;
/**
 * @summary Get primary pattern image
 */
export declare const getPatternImage: (id: number, options?: RequestInit) => Promise<void>;
export declare const getGetPatternImageQueryKey: (id: number) => readonly [`/api/quilting/patterns/${number}/image`];
export declare const getGetPatternImageQueryOptions: <TData = Awaited<ReturnType<typeof getPatternImage>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPatternImage>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getPatternImage>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetPatternImageQueryResult = NonNullable<Awaited<ReturnType<typeof getPatternImage>>>;
export type GetPatternImageQueryError = ErrorType<unknown>;
/**
 * @summary Get primary pattern image
 */
export declare function useGetPatternImage<TData = Awaited<ReturnType<typeof getPatternImage>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPatternImage>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getReanalyzePatternUrl: (id: number) => string;
/**
 * @summary Re-run AI analysis on a pattern using its existing photo
 */
export declare const reanalyzePattern: (id: number, options?: RequestInit) => Promise<QuiltingQuiltPattern>;
export declare const getReanalyzePatternMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof reanalyzePattern>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof reanalyzePattern>>, TError, {
    id: number;
}, TContext>;
export type ReanalyzePatternMutationResult = NonNullable<Awaited<ReturnType<typeof reanalyzePattern>>>;
export type ReanalyzePatternMutationError = ErrorType<Error>;
/**
* @summary Re-run AI analysis on a pattern using its existing photo
*/
export declare const useReanalyzePattern: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof reanalyzePattern>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof reanalyzePattern>>, TError, {
    id: number;
}, TContext>;
export declare const getEnrichPatternUrl: (id: number) => string;
/**
 * @summary Enrich designer metadata via AI web search (Perplexity)
 */
export declare const enrichPattern: (id: number, options?: RequestInit) => Promise<QuiltingQuiltPattern>;
export declare const getEnrichPatternMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof enrichPattern>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof enrichPattern>>, TError, {
    id: number;
}, TContext>;
export type EnrichPatternMutationResult = NonNullable<Awaited<ReturnType<typeof enrichPattern>>>;
export type EnrichPatternMutationError = ErrorType<Error>;
/**
* @summary Enrich designer metadata via AI web search (Perplexity)
*/
export declare const useEnrichPattern: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof enrichPattern>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof enrichPattern>>, TError, {
    id: number;
}, TContext>;
export declare const getExtractPatternBlocksUrl: (id: number) => string;
/**
 * @summary Extract block grid schema from pattern image via AI
 */
export declare const extractPatternBlocks: (id: number, options?: RequestInit) => Promise<QuiltingExtractBlocksResult>;
export declare const getExtractPatternBlocksMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof extractPatternBlocks>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof extractPatternBlocks>>, TError, {
    id: number;
}, TContext>;
export type ExtractPatternBlocksMutationResult = NonNullable<Awaited<ReturnType<typeof extractPatternBlocks>>>;
export type ExtractPatternBlocksMutationError = ErrorType<Error>;
/**
* @summary Extract block grid schema from pattern image via AI
*/
export declare const useExtractPatternBlocks: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof extractPatternBlocks>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof extractPatternBlocks>>, TError, {
    id: number;
}, TContext>;
export declare const getBulkReanalyzePatternsUrl: () => string;
/**
 * @summary Re-run AI analysis on multiple patterns
 */
export declare const bulkReanalyzePatterns: (quiltingBulkReanalyzeInput: QuiltingBulkReanalyzeInput, options?: RequestInit) => Promise<QuiltingBulkReanalyzeResult>;
export declare const getBulkReanalyzePatternsMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof bulkReanalyzePatterns>>, TError, {
        data: BodyType<QuiltingBulkReanalyzeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof bulkReanalyzePatterns>>, TError, {
    data: BodyType<QuiltingBulkReanalyzeInput>;
}, TContext>;
export type BulkReanalyzePatternsMutationResult = NonNullable<Awaited<ReturnType<typeof bulkReanalyzePatterns>>>;
export type BulkReanalyzePatternsMutationBody = BodyType<QuiltingBulkReanalyzeInput>;
export type BulkReanalyzePatternsMutationError = ErrorType<unknown>;
/**
* @summary Re-run AI analysis on multiple patterns
*/
export declare const useBulkReanalyzePatterns: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof bulkReanalyzePatterns>>, TError, {
        data: BodyType<QuiltingBulkReanalyzeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof bulkReanalyzePatterns>>, TError, {
    data: BodyType<QuiltingBulkReanalyzeInput>;
}, TContext>;
export declare const getAddPatternImageUrl: (id: number) => string;
/**
 * @summary Add a supplemental image to a pattern
 */
export declare const addPatternImage: (id: number, quiltingAddImageInput: QuiltingAddImageInput, options?: RequestInit) => Promise<QuiltingEntityImage>;
export declare const getAddPatternImageMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof addPatternImage>>, TError, {
        id: number;
        data: BodyType<QuiltingAddImageInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof addPatternImage>>, TError, {
    id: number;
    data: BodyType<QuiltingAddImageInput>;
}, TContext>;
export type AddPatternImageMutationResult = NonNullable<Awaited<ReturnType<typeof addPatternImage>>>;
export type AddPatternImageMutationBody = BodyType<QuiltingAddImageInput>;
export type AddPatternImageMutationError = ErrorType<unknown>;
/**
* @summary Add a supplemental image to a pattern
*/
export declare const useAddPatternImage: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof addPatternImage>>, TError, {
        id: number;
        data: BodyType<QuiltingAddImageInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof addPatternImage>>, TError, {
    id: number;
    data: BodyType<QuiltingAddImageInput>;
}, TContext>;
export declare const getGetPatternSupplementalImageUrl: (id: number, imageId: number) => string;
/**
 * @summary Get a supplemental pattern image
 */
export declare const getPatternSupplementalImage: (id: number, imageId: number, options?: RequestInit) => Promise<void>;
export declare const getGetPatternSupplementalImageQueryKey: (id: number, imageId: number) => readonly [`/api/quilting/patterns/${number}/images/${number}`];
export declare const getGetPatternSupplementalImageQueryOptions: <TData = Awaited<ReturnType<typeof getPatternSupplementalImage>>, TError = ErrorType<unknown>>(id: number, imageId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPatternSupplementalImage>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getPatternSupplementalImage>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetPatternSupplementalImageQueryResult = NonNullable<Awaited<ReturnType<typeof getPatternSupplementalImage>>>;
export type GetPatternSupplementalImageQueryError = ErrorType<unknown>;
/**
 * @summary Get a supplemental pattern image
 */
export declare function useGetPatternSupplementalImage<TData = Awaited<ReturnType<typeof getPatternSupplementalImage>>, TError = ErrorType<unknown>>(id: number, imageId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPatternSupplementalImage>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdatePatternImageUrl: (id: number, imageId: number) => string;
/**
 * @summary Update a supplemental pattern image
 */
export declare const updatePatternImage: (id: number, imageId: number, quiltingUpdateImageInput: QuiltingUpdateImageInput, options?: RequestInit) => Promise<QuiltingEntityImage>;
export declare const getUpdatePatternImageMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updatePatternImage>>, TError, {
        id: number;
        imageId: number;
        data: BodyType<QuiltingUpdateImageInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updatePatternImage>>, TError, {
    id: number;
    imageId: number;
    data: BodyType<QuiltingUpdateImageInput>;
}, TContext>;
export type UpdatePatternImageMutationResult = NonNullable<Awaited<ReturnType<typeof updatePatternImage>>>;
export type UpdatePatternImageMutationBody = BodyType<QuiltingUpdateImageInput>;
export type UpdatePatternImageMutationError = ErrorType<unknown>;
/**
* @summary Update a supplemental pattern image
*/
export declare const useUpdatePatternImage: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updatePatternImage>>, TError, {
        id: number;
        imageId: number;
        data: BodyType<QuiltingUpdateImageInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updatePatternImage>>, TError, {
    id: number;
    imageId: number;
    data: BodyType<QuiltingUpdateImageInput>;
}, TContext>;
export declare const getDeletePatternImageUrl: (id: number, imageId: number) => string;
/**
 * @summary Delete a supplemental pattern image
 */
export declare const deletePatternImage: (id: number, imageId: number, options?: RequestInit) => Promise<void>;
export declare const getDeletePatternImageMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deletePatternImage>>, TError, {
        id: number;
        imageId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deletePatternImage>>, TError, {
    id: number;
    imageId: number;
}, TContext>;
export type DeletePatternImageMutationResult = NonNullable<Awaited<ReturnType<typeof deletePatternImage>>>;
export type DeletePatternImageMutationError = ErrorType<unknown>;
/**
* @summary Delete a supplemental pattern image
*/
export declare const useDeletePatternImage: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deletePatternImage>>, TError, {
        id: number;
        imageId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deletePatternImage>>, TError, {
    id: number;
    imageId: number;
}, TContext>;
export declare const getListQuiltsUrl: (params?: ListQuiltsParams) => string;
/**
 * @summary List all finished quilts
 */
export declare const listQuilts: (params?: ListQuiltsParams, options?: RequestInit) => Promise<QuiltingQuiltsListResponse>;
export declare const getListQuiltsQueryKey: (params?: ListQuiltsParams) => readonly ["/api/quilting/quilts", ...ListQuiltsParams[]];
export declare const getListQuiltsQueryOptions: <TData = Awaited<ReturnType<typeof listQuilts>>, TError = ErrorType<unknown>>(params?: ListQuiltsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listQuilts>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listQuilts>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListQuiltsQueryResult = NonNullable<Awaited<ReturnType<typeof listQuilts>>>;
export type ListQuiltsQueryError = ErrorType<unknown>;
/**
 * @summary List all finished quilts
 */
export declare function useListQuilts<TData = Awaited<ReturnType<typeof listQuilts>>, TError = ErrorType<unknown>>(params?: ListQuiltsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listQuilts>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateQuiltUrl: () => string;
/**
 * @summary Add a finished quilt
 */
export declare const createQuilt: (quiltingCreateQuiltInput: QuiltingCreateQuiltInput, options?: RequestInit) => Promise<QuiltingFinishedQuilt>;
export declare const getCreateQuiltMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createQuilt>>, TError, {
        data: BodyType<QuiltingCreateQuiltInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createQuilt>>, TError, {
    data: BodyType<QuiltingCreateQuiltInput>;
}, TContext>;
export type CreateQuiltMutationResult = NonNullable<Awaited<ReturnType<typeof createQuilt>>>;
export type CreateQuiltMutationBody = BodyType<QuiltingCreateQuiltInput>;
export type CreateQuiltMutationError = ErrorType<unknown>;
/**
* @summary Add a finished quilt
*/
export declare const useCreateQuilt: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createQuilt>>, TError, {
        data: BodyType<QuiltingCreateQuiltInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createQuilt>>, TError, {
    data: BodyType<QuiltingCreateQuiltInput>;
}, TContext>;
export declare const getGetQuiltUrl: (id: number) => string;
/**
 * @summary Get a finished quilt by ID
 */
export declare const getQuilt: (id: number, options?: RequestInit) => Promise<QuiltingFinishedQuilt>;
export declare const getGetQuiltQueryKey: (id: number) => readonly [`/api/quilting/quilts/${number}`];
export declare const getGetQuiltQueryOptions: <TData = Awaited<ReturnType<typeof getQuilt>>, TError = ErrorType<Error>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getQuilt>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getQuilt>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetQuiltQueryResult = NonNullable<Awaited<ReturnType<typeof getQuilt>>>;
export type GetQuiltQueryError = ErrorType<Error>;
/**
 * @summary Get a finished quilt by ID
 */
export declare function useGetQuilt<TData = Awaited<ReturnType<typeof getQuilt>>, TError = ErrorType<Error>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getQuilt>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateQuiltUrl: (id: number) => string;
/**
 * @summary Update quilt metadata
 */
export declare const updateQuilt: (id: number, quiltingUpdateQuiltInput: QuiltingUpdateQuiltInput, options?: RequestInit) => Promise<QuiltingFinishedQuilt>;
export declare const getUpdateQuiltMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateQuilt>>, TError, {
        id: number;
        data: BodyType<QuiltingUpdateQuiltInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateQuilt>>, TError, {
    id: number;
    data: BodyType<QuiltingUpdateQuiltInput>;
}, TContext>;
export type UpdateQuiltMutationResult = NonNullable<Awaited<ReturnType<typeof updateQuilt>>>;
export type UpdateQuiltMutationBody = BodyType<QuiltingUpdateQuiltInput>;
export type UpdateQuiltMutationError = ErrorType<unknown>;
/**
* @summary Update quilt metadata
*/
export declare const useUpdateQuilt: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateQuilt>>, TError, {
        id: number;
        data: BodyType<QuiltingUpdateQuiltInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateQuilt>>, TError, {
    id: number;
    data: BodyType<QuiltingUpdateQuiltInput>;
}, TContext>;
export declare const getDeleteQuiltUrl: (id: number) => string;
/**
 * @summary Delete a finished quilt
 */
export declare const deleteQuilt: (id: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteQuiltMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteQuilt>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteQuilt>>, TError, {
    id: number;
}, TContext>;
export type DeleteQuiltMutationResult = NonNullable<Awaited<ReturnType<typeof deleteQuilt>>>;
export type DeleteQuiltMutationError = ErrorType<unknown>;
/**
* @summary Delete a finished quilt
*/
export declare const useDeleteQuilt: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteQuilt>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteQuilt>>, TError, {
    id: number;
}, TContext>;
export declare const getGetQuiltImageUrl: (id: number) => string;
/**
 * @summary Get primary quilt image
 */
export declare const getQuiltImage: (id: number, options?: RequestInit) => Promise<void>;
export declare const getGetQuiltImageQueryKey: (id: number) => readonly [`/api/quilting/quilts/${number}/image`];
export declare const getGetQuiltImageQueryOptions: <TData = Awaited<ReturnType<typeof getQuiltImage>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getQuiltImage>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getQuiltImage>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetQuiltImageQueryResult = NonNullable<Awaited<ReturnType<typeof getQuiltImage>>>;
export type GetQuiltImageQueryError = ErrorType<unknown>;
/**
 * @summary Get primary quilt image
 */
export declare function useGetQuiltImage<TData = Awaited<ReturnType<typeof getQuiltImage>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getQuiltImage>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getReanalyzeQuiltUrl: (id: number) => string;
/**
 * @summary Re-run AI analysis on a quilt using its existing photo
 */
export declare const reanalyzeQuilt: (id: number, options?: RequestInit) => Promise<QuiltingFinishedQuilt>;
export declare const getReanalyzeQuiltMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof reanalyzeQuilt>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof reanalyzeQuilt>>, TError, {
    id: number;
}, TContext>;
export type ReanalyzeQuiltMutationResult = NonNullable<Awaited<ReturnType<typeof reanalyzeQuilt>>>;
export type ReanalyzeQuiltMutationError = ErrorType<Error>;
/**
* @summary Re-run AI analysis on a quilt using its existing photo
*/
export declare const useReanalyzeQuilt: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof reanalyzeQuilt>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof reanalyzeQuilt>>, TError, {
    id: number;
}, TContext>;
export declare const getBulkReanalyzeQuiltsUrl: () => string;
/**
 * @summary Re-run AI analysis on multiple quilts
 */
export declare const bulkReanalyzeQuilts: (quiltingBulkReanalyzeInput: QuiltingBulkReanalyzeInput, options?: RequestInit) => Promise<QuiltingBulkReanalyzeResult>;
export declare const getBulkReanalyzeQuiltsMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof bulkReanalyzeQuilts>>, TError, {
        data: BodyType<QuiltingBulkReanalyzeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof bulkReanalyzeQuilts>>, TError, {
    data: BodyType<QuiltingBulkReanalyzeInput>;
}, TContext>;
export type BulkReanalyzeQuiltsMutationResult = NonNullable<Awaited<ReturnType<typeof bulkReanalyzeQuilts>>>;
export type BulkReanalyzeQuiltsMutationBody = BodyType<QuiltingBulkReanalyzeInput>;
export type BulkReanalyzeQuiltsMutationError = ErrorType<unknown>;
/**
* @summary Re-run AI analysis on multiple quilts
*/
export declare const useBulkReanalyzeQuilts: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof bulkReanalyzeQuilts>>, TError, {
        data: BodyType<QuiltingBulkReanalyzeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof bulkReanalyzeQuilts>>, TError, {
    data: BodyType<QuiltingBulkReanalyzeInput>;
}, TContext>;
export declare const getAddQuiltImageUrl: (id: number) => string;
/**
 * @summary Add a supplemental image to a quilt
 */
export declare const addQuiltImage: (id: number, quiltingAddImageInput: QuiltingAddImageInput, options?: RequestInit) => Promise<QuiltingEntityImage>;
export declare const getAddQuiltImageMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof addQuiltImage>>, TError, {
        id: number;
        data: BodyType<QuiltingAddImageInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof addQuiltImage>>, TError, {
    id: number;
    data: BodyType<QuiltingAddImageInput>;
}, TContext>;
export type AddQuiltImageMutationResult = NonNullable<Awaited<ReturnType<typeof addQuiltImage>>>;
export type AddQuiltImageMutationBody = BodyType<QuiltingAddImageInput>;
export type AddQuiltImageMutationError = ErrorType<unknown>;
/**
* @summary Add a supplemental image to a quilt
*/
export declare const useAddQuiltImage: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof addQuiltImage>>, TError, {
        id: number;
        data: BodyType<QuiltingAddImageInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof addQuiltImage>>, TError, {
    id: number;
    data: BodyType<QuiltingAddImageInput>;
}, TContext>;
export declare const getGetQuiltSupplementalImageUrl: (id: number, imageId: number) => string;
/**
 * @summary Get a supplemental quilt image
 */
export declare const getQuiltSupplementalImage: (id: number, imageId: number, options?: RequestInit) => Promise<void>;
export declare const getGetQuiltSupplementalImageQueryKey: (id: number, imageId: number) => readonly [`/api/quilting/quilts/${number}/images/${number}`];
export declare const getGetQuiltSupplementalImageQueryOptions: <TData = Awaited<ReturnType<typeof getQuiltSupplementalImage>>, TError = ErrorType<unknown>>(id: number, imageId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getQuiltSupplementalImage>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getQuiltSupplementalImage>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetQuiltSupplementalImageQueryResult = NonNullable<Awaited<ReturnType<typeof getQuiltSupplementalImage>>>;
export type GetQuiltSupplementalImageQueryError = ErrorType<unknown>;
/**
 * @summary Get a supplemental quilt image
 */
export declare function useGetQuiltSupplementalImage<TData = Awaited<ReturnType<typeof getQuiltSupplementalImage>>, TError = ErrorType<unknown>>(id: number, imageId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getQuiltSupplementalImage>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateQuiltImageUrl: (id: number, imageId: number) => string;
/**
 * @summary Update a supplemental quilt image
 */
export declare const updateQuiltImage: (id: number, imageId: number, quiltingUpdateImageInput: QuiltingUpdateImageInput, options?: RequestInit) => Promise<QuiltingEntityImage>;
export declare const getUpdateQuiltImageMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateQuiltImage>>, TError, {
        id: number;
        imageId: number;
        data: BodyType<QuiltingUpdateImageInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateQuiltImage>>, TError, {
    id: number;
    imageId: number;
    data: BodyType<QuiltingUpdateImageInput>;
}, TContext>;
export type UpdateQuiltImageMutationResult = NonNullable<Awaited<ReturnType<typeof updateQuiltImage>>>;
export type UpdateQuiltImageMutationBody = BodyType<QuiltingUpdateImageInput>;
export type UpdateQuiltImageMutationError = ErrorType<unknown>;
/**
* @summary Update a supplemental quilt image
*/
export declare const useUpdateQuiltImage: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateQuiltImage>>, TError, {
        id: number;
        imageId: number;
        data: BodyType<QuiltingUpdateImageInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateQuiltImage>>, TError, {
    id: number;
    imageId: number;
    data: BodyType<QuiltingUpdateImageInput>;
}, TContext>;
export declare const getDeleteQuiltImageUrl: (id: number, imageId: number) => string;
/**
 * @summary Delete a supplemental quilt image
 */
export declare const deleteQuiltImage: (id: number, imageId: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteQuiltImageMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteQuiltImage>>, TError, {
        id: number;
        imageId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteQuiltImage>>, TError, {
    id: number;
    imageId: number;
}, TContext>;
export type DeleteQuiltImageMutationResult = NonNullable<Awaited<ReturnType<typeof deleteQuiltImage>>>;
export type DeleteQuiltImageMutationError = ErrorType<unknown>;
/**
* @summary Delete a supplemental quilt image
*/
export declare const useDeleteQuiltImage: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteQuiltImage>>, TError, {
        id: number;
        imageId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteQuiltImage>>, TError, {
    id: number;
    imageId: number;
}, TContext>;
export declare const getCompareFabricUrl: () => string;
/**
 * @summary Check if a fabric photo matches anything in the collection
 */
export declare const compareFabric: (compareFabricBody: CompareFabricBody, options?: RequestInit) => Promise<QuiltingCompareResult>;
export declare const getCompareFabricMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof compareFabric>>, TError, {
        data: BodyType<CompareFabricBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof compareFabric>>, TError, {
    data: BodyType<CompareFabricBody>;
}, TContext>;
export type CompareFabricMutationResult = NonNullable<Awaited<ReturnType<typeof compareFabric>>>;
export type CompareFabricMutationBody = BodyType<CompareFabricBody>;
export type CompareFabricMutationError = ErrorType<Error>;
/**
* @summary Check if a fabric photo matches anything in the collection
*/
export declare const useCompareFabric: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof compareFabric>>, TError, {
        data: BodyType<CompareFabricBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof compareFabric>>, TError, {
    data: BodyType<CompareFabricBody>;
}, TContext>;
export declare const getPaletteMatchFabricsUrl: () => string;
/**
 * @summary Extract a colour palette from an inspiration image and find matching fabrics
 */
export declare const paletteMatchFabrics: (paletteMatchFabricsBody: PaletteMatchFabricsBody, options?: RequestInit) => Promise<QuiltingPaletteMatchFabricResponse>;
export declare const getPaletteMatchFabricsMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof paletteMatchFabrics>>, TError, {
        data: BodyType<PaletteMatchFabricsBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof paletteMatchFabrics>>, TError, {
    data: BodyType<PaletteMatchFabricsBody>;
}, TContext>;
export type PaletteMatchFabricsMutationResult = NonNullable<Awaited<ReturnType<typeof paletteMatchFabrics>>>;
export type PaletteMatchFabricsMutationBody = BodyType<PaletteMatchFabricsBody>;
export type PaletteMatchFabricsMutationError = ErrorType<Error>;
/**
* @summary Extract a colour palette from an inspiration image and find matching fabrics
*/
export declare const usePaletteMatchFabrics: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof paletteMatchFabrics>>, TError, {
        data: BodyType<PaletteMatchFabricsBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof paletteMatchFabrics>>, TError, {
    data: BodyType<PaletteMatchFabricsBody>;
}, TContext>;
export declare const getPaletteMatchPatternsUrl: () => string;
/**
 * @summary Extract a colour palette from an inspiration image and find matching quilt patterns
 */
export declare const paletteMatchPatterns: (paletteMatchPatternsBody: PaletteMatchPatternsBody, options?: RequestInit) => Promise<QuiltingPaletteMatchPatternResponse>;
export declare const getPaletteMatchPatternsMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof paletteMatchPatterns>>, TError, {
        data: BodyType<PaletteMatchPatternsBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof paletteMatchPatterns>>, TError, {
    data: BodyType<PaletteMatchPatternsBody>;
}, TContext>;
export type PaletteMatchPatternsMutationResult = NonNullable<Awaited<ReturnType<typeof paletteMatchPatterns>>>;
export type PaletteMatchPatternsMutationBody = BodyType<PaletteMatchPatternsBody>;
export type PaletteMatchPatternsMutationError = ErrorType<Error>;
/**
* @summary Extract a colour palette from an inspiration image and find matching quilt patterns
*/
export declare const usePaletteMatchPatterns: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof paletteMatchPatterns>>, TError, {
        data: BodyType<PaletteMatchPatternsBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof paletteMatchPatterns>>, TError, {
    data: BodyType<PaletteMatchPatternsBody>;
}, TContext>;
export declare const getPaletteMatchQuiltsUrl: () => string;
/**
 * @summary Extract a colour palette from an inspiration image and find matching finished quilts
 */
export declare const paletteMatchQuilts: (paletteMatchQuiltsBody: PaletteMatchQuiltsBody, options?: RequestInit) => Promise<QuiltingPaletteMatchQuiltResponse>;
export declare const getPaletteMatchQuiltsMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof paletteMatchQuilts>>, TError, {
        data: BodyType<PaletteMatchQuiltsBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof paletteMatchQuilts>>, TError, {
    data: BodyType<PaletteMatchQuiltsBody>;
}, TContext>;
export type PaletteMatchQuiltsMutationResult = NonNullable<Awaited<ReturnType<typeof paletteMatchQuilts>>>;
export type PaletteMatchQuiltsMutationBody = BodyType<PaletteMatchQuiltsBody>;
export type PaletteMatchQuiltsMutationError = ErrorType<Error>;
/**
* @summary Extract a colour palette from an inspiration image and find matching finished quilts
*/
export declare const usePaletteMatchQuilts: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof paletteMatchQuilts>>, TError, {
        data: BodyType<PaletteMatchQuiltsBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof paletteMatchQuilts>>, TError, {
    data: BodyType<PaletteMatchQuiltsBody>;
}, TContext>;
export declare const getListQuiltingCategoriesUrl: () => string;
/**
 * @summary List all categories with usage counts
 */
export declare const listQuiltingCategories: (options?: RequestInit) => Promise<QuiltingCategoryWithCount[]>;
export declare const getListQuiltingCategoriesQueryKey: () => readonly ["/api/quilting/categories"];
export declare const getListQuiltingCategoriesQueryOptions: <TData = Awaited<ReturnType<typeof listQuiltingCategories>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listQuiltingCategories>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listQuiltingCategories>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListQuiltingCategoriesQueryResult = NonNullable<Awaited<ReturnType<typeof listQuiltingCategories>>>;
export type ListQuiltingCategoriesQueryError = ErrorType<unknown>;
/**
 * @summary List all categories with usage counts
 */
export declare function useListQuiltingCategories<TData = Awaited<ReturnType<typeof listQuiltingCategories>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listQuiltingCategories>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateQuiltingCategoryUrl: () => string;
/**
 * @summary Create a category
 */
export declare const createQuiltingCategory: (quiltingCreateCategoryInput: QuiltingCreateCategoryInput, options?: RequestInit) => Promise<QuiltingCategoryWithCount>;
export declare const getCreateQuiltingCategoryMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createQuiltingCategory>>, TError, {
        data: BodyType<QuiltingCreateCategoryInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createQuiltingCategory>>, TError, {
    data: BodyType<QuiltingCreateCategoryInput>;
}, TContext>;
export type CreateQuiltingCategoryMutationResult = NonNullable<Awaited<ReturnType<typeof createQuiltingCategory>>>;
export type CreateQuiltingCategoryMutationBody = BodyType<QuiltingCreateCategoryInput>;
export type CreateQuiltingCategoryMutationError = ErrorType<Error>;
/**
* @summary Create a category
*/
export declare const useCreateQuiltingCategory: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createQuiltingCategory>>, TError, {
        data: BodyType<QuiltingCreateCategoryInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createQuiltingCategory>>, TError, {
    data: BodyType<QuiltingCreateCategoryInput>;
}, TContext>;
export declare const getDeleteQuiltingUnusedCategoriesUrl: () => string;
/**
 * @summary Delete all categories with no assignments
 */
export declare const deleteQuiltingUnusedCategories: (options?: RequestInit) => Promise<DeleteQuiltingUnusedCategories200>;
export declare const getDeleteQuiltingUnusedCategoriesMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteQuiltingUnusedCategories>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteQuiltingUnusedCategories>>, TError, void, TContext>;
export type DeleteQuiltingUnusedCategoriesMutationResult = NonNullable<Awaited<ReturnType<typeof deleteQuiltingUnusedCategories>>>;
export type DeleteQuiltingUnusedCategoriesMutationError = ErrorType<unknown>;
/**
* @summary Delete all categories with no assignments
*/
export declare const useDeleteQuiltingUnusedCategories: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteQuiltingUnusedCategories>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteQuiltingUnusedCategories>>, TError, void, TContext>;
export declare const getRenameQuiltingCategoryUrl: (id: number) => string;
/**
 * @summary Rename a category
 */
export declare const renameQuiltingCategory: (id: number, quiltingRenameCategoryInput: QuiltingRenameCategoryInput, options?: RequestInit) => Promise<QuiltingCategoryWithCount>;
export declare const getRenameQuiltingCategoryMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof renameQuiltingCategory>>, TError, {
        id: number;
        data: BodyType<QuiltingRenameCategoryInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof renameQuiltingCategory>>, TError, {
    id: number;
    data: BodyType<QuiltingRenameCategoryInput>;
}, TContext>;
export type RenameQuiltingCategoryMutationResult = NonNullable<Awaited<ReturnType<typeof renameQuiltingCategory>>>;
export type RenameQuiltingCategoryMutationBody = BodyType<QuiltingRenameCategoryInput>;
export type RenameQuiltingCategoryMutationError = ErrorType<unknown>;
/**
* @summary Rename a category
*/
export declare const useRenameQuiltingCategory: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof renameQuiltingCategory>>, TError, {
        id: number;
        data: BodyType<QuiltingRenameCategoryInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof renameQuiltingCategory>>, TError, {
    id: number;
    data: BodyType<QuiltingRenameCategoryInput>;
}, TContext>;
export declare const getDeleteQuiltingCategoryUrl: (id: number) => string;
/**
 * @summary Delete a category
 */
export declare const deleteQuiltingCategory: (id: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteQuiltingCategoryMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteQuiltingCategory>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteQuiltingCategory>>, TError, {
    id: number;
}, TContext>;
export type DeleteQuiltingCategoryMutationResult = NonNullable<Awaited<ReturnType<typeof deleteQuiltingCategory>>>;
export type DeleteQuiltingCategoryMutationError = ErrorType<unknown>;
/**
* @summary Delete a category
*/
export declare const useDeleteQuiltingCategory: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteQuiltingCategory>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteQuiltingCategory>>, TError, {
    id: number;
}, TContext>;
export declare const getUpdateQuiltingCategoryColorsUrl: (id: number) => string;
/**
 * @summary Update category badge colours
 */
export declare const updateQuiltingCategoryColors: (id: number, quiltingUpdateCategoryColorsInput: QuiltingUpdateCategoryColorsInput, options?: RequestInit) => Promise<QuiltingCategoryWithCount>;
export declare const getUpdateQuiltingCategoryColorsMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateQuiltingCategoryColors>>, TError, {
        id: number;
        data: BodyType<QuiltingUpdateCategoryColorsInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateQuiltingCategoryColors>>, TError, {
    id: number;
    data: BodyType<QuiltingUpdateCategoryColorsInput>;
}, TContext>;
export type UpdateQuiltingCategoryColorsMutationResult = NonNullable<Awaited<ReturnType<typeof updateQuiltingCategoryColors>>>;
export type UpdateQuiltingCategoryColorsMutationBody = BodyType<QuiltingUpdateCategoryColorsInput>;
export type UpdateQuiltingCategoryColorsMutationError = ErrorType<unknown>;
/**
* @summary Update category badge colours
*/
export declare const useUpdateQuiltingCategoryColors: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateQuiltingCategoryColors>>, TError, {
        id: number;
        data: BodyType<QuiltingUpdateCategoryColorsInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateQuiltingCategoryColors>>, TError, {
    id: number;
    data: BodyType<QuiltingUpdateCategoryColorsInput>;
}, TContext>;
export declare const getMergeQuiltingCategoryUrl: (id: number) => string;
/**
 * @summary Merge a category into another
 */
export declare const mergeQuiltingCategory: (id: number, quiltingMergeCategoryInput: QuiltingMergeCategoryInput, options?: RequestInit) => Promise<MergeQuiltingCategory200>;
export declare const getMergeQuiltingCategoryMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof mergeQuiltingCategory>>, TError, {
        id: number;
        data: BodyType<QuiltingMergeCategoryInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof mergeQuiltingCategory>>, TError, {
    id: number;
    data: BodyType<QuiltingMergeCategoryInput>;
}, TContext>;
export type MergeQuiltingCategoryMutationResult = NonNullable<Awaited<ReturnType<typeof mergeQuiltingCategory>>>;
export type MergeQuiltingCategoryMutationBody = BodyType<QuiltingMergeCategoryInput>;
export type MergeQuiltingCategoryMutationError = ErrorType<unknown>;
/**
* @summary Merge a category into another
*/
export declare const useMergeQuiltingCategory: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof mergeQuiltingCategory>>, TError, {
        id: number;
        data: BodyType<QuiltingMergeCategoryInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof mergeQuiltingCategory>>, TError, {
    id: number;
    data: BodyType<QuiltingMergeCategoryInput>;
}, TContext>;
export declare const getListShoppingItemsUrl: () => string;
/**
 * @summary List all shopping items
 */
export declare const listShoppingItems: (options?: RequestInit) => Promise<QuiltingShoppingItem[]>;
export declare const getListShoppingItemsQueryKey: () => readonly ["/api/quilting/shopping"];
export declare const getListShoppingItemsQueryOptions: <TData = Awaited<ReturnType<typeof listShoppingItems>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listShoppingItems>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listShoppingItems>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListShoppingItemsQueryResult = NonNullable<Awaited<ReturnType<typeof listShoppingItems>>>;
export type ListShoppingItemsQueryError = ErrorType<unknown>;
/**
 * @summary List all shopping items
 */
export declare function useListShoppingItems<TData = Awaited<ReturnType<typeof listShoppingItems>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listShoppingItems>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateShoppingItemUrl: () => string;
/**
 * @summary Create a shopping item
 */
export declare const createShoppingItem: (quiltingCreateShoppingItemInput: QuiltingCreateShoppingItemInput, options?: RequestInit) => Promise<QuiltingShoppingItem>;
export declare const getCreateShoppingItemMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createShoppingItem>>, TError, {
        data: BodyType<QuiltingCreateShoppingItemInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createShoppingItem>>, TError, {
    data: BodyType<QuiltingCreateShoppingItemInput>;
}, TContext>;
export type CreateShoppingItemMutationResult = NonNullable<Awaited<ReturnType<typeof createShoppingItem>>>;
export type CreateShoppingItemMutationBody = BodyType<QuiltingCreateShoppingItemInput>;
export type CreateShoppingItemMutationError = ErrorType<unknown>;
/**
* @summary Create a shopping item
*/
export declare const useCreateShoppingItem: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createShoppingItem>>, TError, {
        data: BodyType<QuiltingCreateShoppingItemInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createShoppingItem>>, TError, {
    data: BodyType<QuiltingCreateShoppingItemInput>;
}, TContext>;
export declare const getGetShoppingStatsUrl: () => string;
/**
 * @summary Budget summary statistics
 */
export declare const getShoppingStats: (options?: RequestInit) => Promise<QuiltingShoppingStats>;
export declare const getGetShoppingStatsQueryKey: () => readonly ["/api/quilting/shopping/stats"];
export declare const getGetShoppingStatsQueryOptions: <TData = Awaited<ReturnType<typeof getShoppingStats>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getShoppingStats>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getShoppingStats>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetShoppingStatsQueryResult = NonNullable<Awaited<ReturnType<typeof getShoppingStats>>>;
export type GetShoppingStatsQueryError = ErrorType<unknown>;
/**
 * @summary Budget summary statistics
 */
export declare function useGetShoppingStats<TData = Awaited<ReturnType<typeof getShoppingStats>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getShoppingStats>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetShoppingItemUrl: (id: number) => string;
/**
 * @summary Get a shopping item by ID
 */
export declare const getShoppingItem: (id: number, options?: RequestInit) => Promise<QuiltingShoppingItem>;
export declare const getGetShoppingItemQueryKey: (id: number) => readonly [`/api/quilting/shopping/${number}`];
export declare const getGetShoppingItemQueryOptions: <TData = Awaited<ReturnType<typeof getShoppingItem>>, TError = ErrorType<Error>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getShoppingItem>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getShoppingItem>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetShoppingItemQueryResult = NonNullable<Awaited<ReturnType<typeof getShoppingItem>>>;
export type GetShoppingItemQueryError = ErrorType<Error>;
/**
 * @summary Get a shopping item by ID
 */
export declare function useGetShoppingItem<TData = Awaited<ReturnType<typeof getShoppingItem>>, TError = ErrorType<Error>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getShoppingItem>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateShoppingItemUrl: (id: number) => string;
/**
 * @summary Update a shopping item
 */
export declare const updateShoppingItem: (id: number, quiltingUpdateShoppingItemInput: QuiltingUpdateShoppingItemInput, options?: RequestInit) => Promise<QuiltingShoppingItem>;
export declare const getUpdateShoppingItemMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateShoppingItem>>, TError, {
        id: number;
        data: BodyType<QuiltingUpdateShoppingItemInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateShoppingItem>>, TError, {
    id: number;
    data: BodyType<QuiltingUpdateShoppingItemInput>;
}, TContext>;
export type UpdateShoppingItemMutationResult = NonNullable<Awaited<ReturnType<typeof updateShoppingItem>>>;
export type UpdateShoppingItemMutationBody = BodyType<QuiltingUpdateShoppingItemInput>;
export type UpdateShoppingItemMutationError = ErrorType<unknown>;
/**
* @summary Update a shopping item
*/
export declare const useUpdateShoppingItem: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateShoppingItem>>, TError, {
        id: number;
        data: BodyType<QuiltingUpdateShoppingItemInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateShoppingItem>>, TError, {
    id: number;
    data: BodyType<QuiltingUpdateShoppingItemInput>;
}, TContext>;
export declare const getDeleteShoppingItemUrl: (id: number) => string;
/**
 * @summary Delete a shopping item
 */
export declare const deleteShoppingItem: (id: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteShoppingItemMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteShoppingItem>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteShoppingItem>>, TError, {
    id: number;
}, TContext>;
export type DeleteShoppingItemMutationResult = NonNullable<Awaited<ReturnType<typeof deleteShoppingItem>>>;
export type DeleteShoppingItemMutationError = ErrorType<unknown>;
/**
* @summary Delete a shopping item
*/
export declare const useDeleteShoppingItem: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteShoppingItem>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteShoppingItem>>, TError, {
    id: number;
}, TContext>;
export declare const getListLayoutsUrl: () => string;
/**
 * @summary List all saved quilt layouts
 */
export declare const listLayouts: (options?: RequestInit) => Promise<QuiltingQuiltLayout[]>;
export declare const getListLayoutsQueryKey: () => readonly ["/api/quilting/layouts"];
export declare const getListLayoutsQueryOptions: <TData = Awaited<ReturnType<typeof listLayouts>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listLayouts>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listLayouts>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListLayoutsQueryResult = NonNullable<Awaited<ReturnType<typeof listLayouts>>>;
export type ListLayoutsQueryError = ErrorType<unknown>;
/**
 * @summary List all saved quilt layouts
 */
export declare function useListLayouts<TData = Awaited<ReturnType<typeof listLayouts>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listLayouts>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateLayoutUrl: () => string;
/**
 * @summary Create a new quilt layout
 */
export declare const createLayout: (quiltingCreateLayoutInput: QuiltingCreateLayoutInput, options?: RequestInit) => Promise<QuiltingQuiltLayout>;
export declare const getCreateLayoutMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createLayout>>, TError, {
        data: BodyType<QuiltingCreateLayoutInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createLayout>>, TError, {
    data: BodyType<QuiltingCreateLayoutInput>;
}, TContext>;
export type CreateLayoutMutationResult = NonNullable<Awaited<ReturnType<typeof createLayout>>>;
export type CreateLayoutMutationBody = BodyType<QuiltingCreateLayoutInput>;
export type CreateLayoutMutationError = ErrorType<unknown>;
/**
* @summary Create a new quilt layout
*/
export declare const useCreateLayout: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createLayout>>, TError, {
        data: BodyType<QuiltingCreateLayoutInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createLayout>>, TError, {
    data: BodyType<QuiltingCreateLayoutInput>;
}, TContext>;
export declare const getGetLayoutUrl: (id: number) => string;
/**
 * @summary Get a quilt layout by ID
 */
export declare const getLayout: (id: number, options?: RequestInit) => Promise<QuiltingQuiltLayout>;
export declare const getGetLayoutQueryKey: (id: number) => readonly [`/api/quilting/layouts/${number}`];
export declare const getGetLayoutQueryOptions: <TData = Awaited<ReturnType<typeof getLayout>>, TError = ErrorType<Error>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getLayout>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getLayout>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetLayoutQueryResult = NonNullable<Awaited<ReturnType<typeof getLayout>>>;
export type GetLayoutQueryError = ErrorType<Error>;
/**
 * @summary Get a quilt layout by ID
 */
export declare function useGetLayout<TData = Awaited<ReturnType<typeof getLayout>>, TError = ErrorType<Error>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getLayout>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateLayoutUrl: (id: number) => string;
/**
 * @summary Update a quilt layout
 */
export declare const updateLayout: (id: number, quiltingUpdateLayoutInput: QuiltingUpdateLayoutInput, options?: RequestInit) => Promise<QuiltingQuiltLayout>;
export declare const getUpdateLayoutMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateLayout>>, TError, {
        id: number;
        data: BodyType<QuiltingUpdateLayoutInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateLayout>>, TError, {
    id: number;
    data: BodyType<QuiltingUpdateLayoutInput>;
}, TContext>;
export type UpdateLayoutMutationResult = NonNullable<Awaited<ReturnType<typeof updateLayout>>>;
export type UpdateLayoutMutationBody = BodyType<QuiltingUpdateLayoutInput>;
export type UpdateLayoutMutationError = ErrorType<unknown>;
/**
* @summary Update a quilt layout
*/
export declare const useUpdateLayout: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateLayout>>, TError, {
        id: number;
        data: BodyType<QuiltingUpdateLayoutInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateLayout>>, TError, {
    id: number;
    data: BodyType<QuiltingUpdateLayoutInput>;
}, TContext>;
export declare const getDeleteLayoutUrl: (id: number) => string;
/**
 * @summary Delete a quilt layout
 */
export declare const deleteLayout: (id: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteLayoutMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteLayout>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteLayout>>, TError, {
    id: number;
}, TContext>;
export type DeleteLayoutMutationResult = NonNullable<Awaited<ReturnType<typeof deleteLayout>>>;
export type DeleteLayoutMutationError = ErrorType<unknown>;
/**
* @summary Delete a quilt layout
*/
export declare const useDeleteLayout: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteLayout>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteLayout>>, TError, {
    id: number;
}, TContext>;
export declare const getImportPatternFromUrlUrl: () => string;
/**
 * @summary Import pattern info from a URL using AI
 */
export declare const importPatternFromUrl: (importPatternFromUrlBody: ImportPatternFromUrlBody, options?: RequestInit) => Promise<QuiltingImportedPatternInfo>;
export declare const getImportPatternFromUrlMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof importPatternFromUrl>>, TError, {
        data: BodyType<ImportPatternFromUrlBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof importPatternFromUrl>>, TError, {
    data: BodyType<ImportPatternFromUrlBody>;
}, TContext>;
export type ImportPatternFromUrlMutationResult = NonNullable<Awaited<ReturnType<typeof importPatternFromUrl>>>;
export type ImportPatternFromUrlMutationBody = BodyType<ImportPatternFromUrlBody>;
export type ImportPatternFromUrlMutationError = ErrorType<Error>;
/**
* @summary Import pattern info from a URL using AI
*/
export declare const useImportPatternFromUrl: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof importPatternFromUrl>>, TError, {
        data: BodyType<ImportPatternFromUrlBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof importPatternFromUrl>>, TError, {
    data: BodyType<ImportPatternFromUrlBody>;
}, TContext>;
export declare const getListBlocksUrl: () => string;
/**
 * @summary List all saved block designs
 */
export declare const listBlocks: (options?: RequestInit) => Promise<QuiltingBlock[]>;
export declare const getListBlocksQueryKey: () => readonly ["/api/quilting/blocks"];
export declare const getListBlocksQueryOptions: <TData = Awaited<ReturnType<typeof listBlocks>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listBlocks>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listBlocks>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListBlocksQueryResult = NonNullable<Awaited<ReturnType<typeof listBlocks>>>;
export type ListBlocksQueryError = ErrorType<unknown>;
/**
 * @summary List all saved block designs
 */
export declare function useListBlocks<TData = Awaited<ReturnType<typeof listBlocks>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listBlocks>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateBlockUrl: () => string;
/**
 * @summary Create a new block design
 */
export declare const createBlock: (quiltingCreateBlockInput: QuiltingCreateBlockInput, options?: RequestInit) => Promise<QuiltingBlock>;
export declare const getCreateBlockMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createBlock>>, TError, {
        data: BodyType<QuiltingCreateBlockInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createBlock>>, TError, {
    data: BodyType<QuiltingCreateBlockInput>;
}, TContext>;
export type CreateBlockMutationResult = NonNullable<Awaited<ReturnType<typeof createBlock>>>;
export type CreateBlockMutationBody = BodyType<QuiltingCreateBlockInput>;
export type CreateBlockMutationError = ErrorType<unknown>;
/**
* @summary Create a new block design
*/
export declare const useCreateBlock: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createBlock>>, TError, {
        data: BodyType<QuiltingCreateBlockInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createBlock>>, TError, {
    data: BodyType<QuiltingCreateBlockInput>;
}, TContext>;
export declare const getDetectBlockSeamsUrl: () => string;
/**
 * @summary Use AI to detect seam positions from a block photo
 */
export declare const detectBlockSeams: (quiltingDetectSeamsInput: QuiltingDetectSeamsInput, options?: RequestInit) => Promise<QuiltingDetectedSeams>;
export declare const getDetectBlockSeamsMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof detectBlockSeams>>, TError, {
        data: BodyType<QuiltingDetectSeamsInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof detectBlockSeams>>, TError, {
    data: BodyType<QuiltingDetectSeamsInput>;
}, TContext>;
export type DetectBlockSeamsMutationResult = NonNullable<Awaited<ReturnType<typeof detectBlockSeams>>>;
export type DetectBlockSeamsMutationBody = BodyType<QuiltingDetectSeamsInput>;
export type DetectBlockSeamsMutationError = ErrorType<unknown>;
/**
* @summary Use AI to detect seam positions from a block photo
*/
export declare const useDetectBlockSeams: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof detectBlockSeams>>, TError, {
        data: BodyType<QuiltingDetectSeamsInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof detectBlockSeams>>, TError, {
    data: BodyType<QuiltingDetectSeamsInput>;
}, TContext>;
export declare const getGetBlockUrl: (id: number) => string;
/**
 * @summary Get a block design by ID
 */
export declare const getBlock: (id: number, options?: RequestInit) => Promise<QuiltingBlock>;
export declare const getGetBlockQueryKey: (id: number) => readonly [`/api/quilting/blocks/${number}`];
export declare const getGetBlockQueryOptions: <TData = Awaited<ReturnType<typeof getBlock>>, TError = ErrorType<Error>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getBlock>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getBlock>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetBlockQueryResult = NonNullable<Awaited<ReturnType<typeof getBlock>>>;
export type GetBlockQueryError = ErrorType<Error>;
/**
 * @summary Get a block design by ID
 */
export declare function useGetBlock<TData = Awaited<ReturnType<typeof getBlock>>, TError = ErrorType<Error>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getBlock>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateBlockUrl: (id: number) => string;
/**
 * @summary Update a block design
 */
export declare const updateBlock: (id: number, quiltingUpdateBlockInput: QuiltingUpdateBlockInput, options?: RequestInit) => Promise<QuiltingBlock>;
export declare const getUpdateBlockMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateBlock>>, TError, {
        id: number;
        data: BodyType<QuiltingUpdateBlockInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateBlock>>, TError, {
    id: number;
    data: BodyType<QuiltingUpdateBlockInput>;
}, TContext>;
export type UpdateBlockMutationResult = NonNullable<Awaited<ReturnType<typeof updateBlock>>>;
export type UpdateBlockMutationBody = BodyType<QuiltingUpdateBlockInput>;
export type UpdateBlockMutationError = ErrorType<unknown>;
/**
* @summary Update a block design
*/
export declare const useUpdateBlock: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateBlock>>, TError, {
        id: number;
        data: BodyType<QuiltingUpdateBlockInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateBlock>>, TError, {
    id: number;
    data: BodyType<QuiltingUpdateBlockInput>;
}, TContext>;
export declare const getDeleteBlockUrl: (id: number) => string;
/**
 * @summary Delete a block design
 */
export declare const deleteBlock: (id: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteBlockMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteBlock>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteBlock>>, TError, {
    id: number;
}, TContext>;
export type DeleteBlockMutationResult = NonNullable<Awaited<ReturnType<typeof deleteBlock>>>;
export type DeleteBlockMutationError = ErrorType<unknown>;
/**
* @summary Delete a block design
*/
export declare const useDeleteBlock: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteBlock>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteBlock>>, TError, {
    id: number;
}, TContext>;
export declare const getGetStatsUrl: () => string;
/**
 * @summary Get collection statistics
 */
export declare const getStats: (options?: RequestInit) => Promise<QuiltingCollectionStats>;
export declare const getGetStatsQueryKey: () => readonly ["/api/quilting/stats"];
export declare const getGetStatsQueryOptions: <TData = Awaited<ReturnType<typeof getStats>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getStats>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getStats>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetStatsQueryResult = NonNullable<Awaited<ReturnType<typeof getStats>>>;
export type GetStatsQueryError = ErrorType<unknown>;
/**
 * @summary Get collection statistics
 */
export declare function useGetStats<TData = Awaited<ReturnType<typeof getStats>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getStats>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetStaleCountUrl: () => string;
/**
 * @summary Count fabrics and patterns missing an AI embedding
 */
export declare const getStaleCount: (options?: RequestInit) => Promise<QuiltingStaleCount>;
export declare const getGetStaleCountQueryKey: () => readonly ["/api/quilting/stats/stale"];
export declare const getGetStaleCountQueryOptions: <TData = Awaited<ReturnType<typeof getStaleCount>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getStaleCount>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getStaleCount>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetStaleCountQueryResult = NonNullable<Awaited<ReturnType<typeof getStaleCount>>>;
export type GetStaleCountQueryError = ErrorType<unknown>;
/**
 * @summary Count fabrics and patterns missing an AI embedding
 */
export declare function useGetStaleCount<TData = Awaited<ReturnType<typeof getStaleCount>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getStaleCount>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getListBlockTemplatesUrl: () => string;
/**
 * @summary List all saved block templates (household-shared)
 */
export declare const listBlockTemplates: (options?: RequestInit) => Promise<QuiltingBlockTemplate[]>;
export declare const getListBlockTemplatesQueryKey: () => readonly ["/api/quilting/block-templates"];
export declare const getListBlockTemplatesQueryOptions: <TData = Awaited<ReturnType<typeof listBlockTemplates>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listBlockTemplates>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listBlockTemplates>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListBlockTemplatesQueryResult = NonNullable<Awaited<ReturnType<typeof listBlockTemplates>>>;
export type ListBlockTemplatesQueryError = ErrorType<unknown>;
/**
 * @summary List all saved block templates (household-shared)
 */
export declare function useListBlockTemplates<TData = Awaited<ReturnType<typeof listBlockTemplates>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listBlockTemplates>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateBlockTemplateUrl: () => string;
/**
 * @summary Save a new block design as a reusable template
 */
export declare const createBlockTemplate: (quiltingCreateBlockTemplateInput: QuiltingCreateBlockTemplateInput, options?: RequestInit) => Promise<QuiltingBlockTemplate>;
export declare const getCreateBlockTemplateMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createBlockTemplate>>, TError, {
        data: BodyType<QuiltingCreateBlockTemplateInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createBlockTemplate>>, TError, {
    data: BodyType<QuiltingCreateBlockTemplateInput>;
}, TContext>;
export type CreateBlockTemplateMutationResult = NonNullable<Awaited<ReturnType<typeof createBlockTemplate>>>;
export type CreateBlockTemplateMutationBody = BodyType<QuiltingCreateBlockTemplateInput>;
export type CreateBlockTemplateMutationError = ErrorType<unknown>;
/**
* @summary Save a new block design as a reusable template
*/
export declare const useCreateBlockTemplate: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createBlockTemplate>>, TError, {
        data: BodyType<QuiltingCreateBlockTemplateInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createBlockTemplate>>, TError, {
    data: BodyType<QuiltingCreateBlockTemplateInput>;
}, TContext>;
export declare const getGetBlockTemplateUrl: (id: number) => string;
/**
 * @summary Get a single block template by ID
 */
export declare const getBlockTemplate: (id: number, options?: RequestInit) => Promise<QuiltingBlockTemplate>;
export declare const getGetBlockTemplateQueryKey: (id: number) => readonly [`/api/quilting/block-templates/${number}`];
export declare const getGetBlockTemplateQueryOptions: <TData = Awaited<ReturnType<typeof getBlockTemplate>>, TError = ErrorType<void>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getBlockTemplate>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getBlockTemplate>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetBlockTemplateQueryResult = NonNullable<Awaited<ReturnType<typeof getBlockTemplate>>>;
export type GetBlockTemplateQueryError = ErrorType<void>;
/**
 * @summary Get a single block template by ID
 */
export declare function useGetBlockTemplate<TData = Awaited<ReturnType<typeof getBlockTemplate>>, TError = ErrorType<void>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getBlockTemplate>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getPatchBlockTemplateUrl: (id: number) => string;
/**
 * @summary Rename or retag a block template
 */
export declare const patchBlockTemplate: (id: number, quiltingUpdateBlockTemplateInput: QuiltingUpdateBlockTemplateInput, options?: RequestInit) => Promise<QuiltingBlockTemplate>;
export declare const getPatchBlockTemplateMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof patchBlockTemplate>>, TError, {
        id: number;
        data: BodyType<QuiltingUpdateBlockTemplateInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof patchBlockTemplate>>, TError, {
    id: number;
    data: BodyType<QuiltingUpdateBlockTemplateInput>;
}, TContext>;
export type PatchBlockTemplateMutationResult = NonNullable<Awaited<ReturnType<typeof patchBlockTemplate>>>;
export type PatchBlockTemplateMutationBody = BodyType<QuiltingUpdateBlockTemplateInput>;
export type PatchBlockTemplateMutationError = ErrorType<void>;
/**
* @summary Rename or retag a block template
*/
export declare const usePatchBlockTemplate: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof patchBlockTemplate>>, TError, {
        id: number;
        data: BodyType<QuiltingUpdateBlockTemplateInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof patchBlockTemplate>>, TError, {
    id: number;
    data: BodyType<QuiltingUpdateBlockTemplateInput>;
}, TContext>;
export declare const getDeleteBlockTemplateUrl: (id: number) => string;
/**
 * @summary Delete a block template
 */
export declare const deleteBlockTemplate: (id: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteBlockTemplateMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteBlockTemplate>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteBlockTemplate>>, TError, {
    id: number;
}, TContext>;
export type DeleteBlockTemplateMutationResult = NonNullable<Awaited<ReturnType<typeof deleteBlockTemplate>>>;
export type DeleteBlockTemplateMutationError = ErrorType<void>;
/**
* @summary Delete a block template
*/
export declare const useDeleteBlockTemplate: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteBlockTemplate>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteBlockTemplate>>, TError, {
    id: number;
}, TContext>;
export declare const getListTripsUrl: () => string;
/**
 * @summary List all trips for the current user
 */
export declare const listTrips: (options?: RequestInit) => Promise<TravelsListTripsResponse>;
export declare const getListTripsQueryKey: () => readonly ["/api/travels/trips"];
export declare const getListTripsQueryOptions: <TData = Awaited<ReturnType<typeof listTrips>>, TError = ErrorType<Error>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listTrips>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listTrips>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListTripsQueryResult = NonNullable<Awaited<ReturnType<typeof listTrips>>>;
export type ListTripsQueryError = ErrorType<Error>;
/**
 * @summary List all trips for the current user
 */
export declare function useListTrips<TData = Awaited<ReturnType<typeof listTrips>>, TError = ErrorType<Error>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listTrips>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateTripUrl: () => string;
/**
 * @summary Create a new trip
 */
export declare const createTrip: (travelsCreateTripBody: TravelsCreateTripBody, options?: RequestInit) => Promise<TravelsTrip>;
export declare const getCreateTripMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createTrip>>, TError, {
        data: BodyType<TravelsCreateTripBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createTrip>>, TError, {
    data: BodyType<TravelsCreateTripBody>;
}, TContext>;
export type CreateTripMutationResult = NonNullable<Awaited<ReturnType<typeof createTrip>>>;
export type CreateTripMutationBody = BodyType<TravelsCreateTripBody>;
export type CreateTripMutationError = ErrorType<Error>;
/**
* @summary Create a new trip
*/
export declare const useCreateTrip: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createTrip>>, TError, {
        data: BodyType<TravelsCreateTripBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createTrip>>, TError, {
    data: BodyType<TravelsCreateTripBody>;
}, TContext>;
export declare const getGetTripUrl: (id: number) => string;
/**
 * @summary Get a trip by ID
 */
export declare const getTrip: (id: number, options?: RequestInit) => Promise<TravelsTripDetail>;
export declare const getGetTripQueryKey: (id: number) => readonly [`/api/travels/trips/${number}`];
export declare const getGetTripQueryOptions: <TData = Awaited<ReturnType<typeof getTrip>>, TError = ErrorType<Error>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getTrip>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getTrip>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetTripQueryResult = NonNullable<Awaited<ReturnType<typeof getTrip>>>;
export type GetTripQueryError = ErrorType<Error>;
/**
 * @summary Get a trip by ID
 */
export declare function useGetTrip<TData = Awaited<ReturnType<typeof getTrip>>, TError = ErrorType<Error>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getTrip>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateTripUrl: (id: number) => string;
/**
 * @summary Update a trip
 */
export declare const updateTrip: (id: number, travelsUpdateTripBody: TravelsUpdateTripBody, options?: RequestInit) => Promise<TravelsTrip>;
export declare const getUpdateTripMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateTrip>>, TError, {
        id: number;
        data: BodyType<TravelsUpdateTripBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateTrip>>, TError, {
    id: number;
    data: BodyType<TravelsUpdateTripBody>;
}, TContext>;
export type UpdateTripMutationResult = NonNullable<Awaited<ReturnType<typeof updateTrip>>>;
export type UpdateTripMutationBody = BodyType<TravelsUpdateTripBody>;
export type UpdateTripMutationError = ErrorType<Error>;
/**
* @summary Update a trip
*/
export declare const useUpdateTrip: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateTrip>>, TError, {
        id: number;
        data: BodyType<TravelsUpdateTripBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateTrip>>, TError, {
    id: number;
    data: BodyType<TravelsUpdateTripBody>;
}, TContext>;
export declare const getDeleteTripUrl: (id: number) => string;
/**
 * @summary Delete a trip
 */
export declare const deleteTrip: (id: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteTripMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteTrip>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteTrip>>, TError, {
    id: number;
}, TContext>;
export type DeleteTripMutationResult = NonNullable<Awaited<ReturnType<typeof deleteTrip>>>;
export type DeleteTripMutationError = ErrorType<Error>;
/**
* @summary Delete a trip
*/
export declare const useDeleteTrip: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteTrip>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteTrip>>, TError, {
    id: number;
}, TContext>;
export declare const getGenerateItineraryUrl: (id: number) => string;
/**
 * @summary Generate or regenerate AI itinerary for a trip
 */
export declare const generateItinerary: (id: number, travelsGenerateItineraryBody: TravelsGenerateItineraryBody, options?: RequestInit) => Promise<TravelsItineraryResult>;
export declare const getGenerateItineraryMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof generateItinerary>>, TError, {
        id: number;
        data: BodyType<TravelsGenerateItineraryBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof generateItinerary>>, TError, {
    id: number;
    data: BodyType<TravelsGenerateItineraryBody>;
}, TContext>;
export type GenerateItineraryMutationResult = NonNullable<Awaited<ReturnType<typeof generateItinerary>>>;
export type GenerateItineraryMutationBody = BodyType<TravelsGenerateItineraryBody>;
export type GenerateItineraryMutationError = ErrorType<Error>;
/**
* @summary Generate or regenerate AI itinerary for a trip
*/
export declare const useGenerateItinerary: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof generateItinerary>>, TError, {
        id: number;
        data: BodyType<TravelsGenerateItineraryBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof generateItinerary>>, TError, {
    id: number;
    data: BodyType<TravelsGenerateItineraryBody>;
}, TContext>;
export declare const getListTripDocumentsUrl: (id: number) => string;
/**
 * @summary List documents for a trip
 */
export declare const listTripDocuments: (id: number, options?: RequestInit) => Promise<TravelsListDocumentsResponse>;
export declare const getListTripDocumentsQueryKey: (id: number) => readonly [`/api/travels/trips/${number}/documents`];
export declare const getListTripDocumentsQueryOptions: <TData = Awaited<ReturnType<typeof listTripDocuments>>, TError = ErrorType<Error>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listTripDocuments>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listTripDocuments>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListTripDocumentsQueryResult = NonNullable<Awaited<ReturnType<typeof listTripDocuments>>>;
export type ListTripDocumentsQueryError = ErrorType<Error>;
/**
 * @summary List documents for a trip
 */
export declare function useListTripDocuments<TData = Awaited<ReturnType<typeof listTripDocuments>>, TError = ErrorType<Error>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listTripDocuments>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUploadTripDocumentUrl: (id: number) => string;
/**
 * @summary Upload a travel document (PDF or image) with OCR extraction
 */
export declare const uploadTripDocument: (id: number, uploadTripDocumentBody: UploadTripDocumentBody, options?: RequestInit) => Promise<TravelsTripDocument>;
export declare const getUploadTripDocumentMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof uploadTripDocument>>, TError, {
        id: number;
        data: BodyType<UploadTripDocumentBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof uploadTripDocument>>, TError, {
    id: number;
    data: BodyType<UploadTripDocumentBody>;
}, TContext>;
export type UploadTripDocumentMutationResult = NonNullable<Awaited<ReturnType<typeof uploadTripDocument>>>;
export type UploadTripDocumentMutationBody = BodyType<UploadTripDocumentBody>;
export type UploadTripDocumentMutationError = ErrorType<Error>;
/**
* @summary Upload a travel document (PDF or image) with OCR extraction
*/
export declare const useUploadTripDocument: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof uploadTripDocument>>, TError, {
        id: number;
        data: BodyType<UploadTripDocumentBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof uploadTripDocument>>, TError, {
    id: number;
    data: BodyType<UploadTripDocumentBody>;
}, TContext>;
export declare const getUpdateTripDocumentUrl: (id: number, docId: number) => string;
/**
 * @summary Correct/update the extracted data for a trip document
 */
export declare const updateTripDocument: (id: number, docId: number, updateTripDocumentBody: UpdateTripDocumentBody, options?: RequestInit) => Promise<TravelsTripDocument>;
export declare const getUpdateTripDocumentMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateTripDocument>>, TError, {
        id: number;
        docId: number;
        data: BodyType<UpdateTripDocumentBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateTripDocument>>, TError, {
    id: number;
    docId: number;
    data: BodyType<UpdateTripDocumentBody>;
}, TContext>;
export type UpdateTripDocumentMutationResult = NonNullable<Awaited<ReturnType<typeof updateTripDocument>>>;
export type UpdateTripDocumentMutationBody = BodyType<UpdateTripDocumentBody>;
export type UpdateTripDocumentMutationError = ErrorType<Error>;
/**
* @summary Correct/update the extracted data for a trip document
*/
export declare const useUpdateTripDocument: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateTripDocument>>, TError, {
        id: number;
        docId: number;
        data: BodyType<UpdateTripDocumentBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateTripDocument>>, TError, {
    id: number;
    docId: number;
    data: BodyType<UpdateTripDocumentBody>;
}, TContext>;
export declare const getDeleteTripDocumentUrl: (id: number, docId: number) => string;
/**
 * @summary Delete a trip document
 */
export declare const deleteTripDocument: (id: number, docId: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteTripDocumentMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteTripDocument>>, TError, {
        id: number;
        docId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteTripDocument>>, TError, {
    id: number;
    docId: number;
}, TContext>;
export type DeleteTripDocumentMutationResult = NonNullable<Awaited<ReturnType<typeof deleteTripDocument>>>;
export type DeleteTripDocumentMutationError = ErrorType<Error>;
/**
* @summary Delete a trip document
*/
export declare const useDeleteTripDocument: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteTripDocument>>, TError, {
        id: number;
        docId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteTripDocument>>, TError, {
    id: number;
    docId: number;
}, TContext>;
export declare const getRescanTripDocumentUrl: (id: number, docId: number) => string;
/**
 * @summary Re-run AI extraction on a previously uploaded document, respecting locked fields
 */
export declare const rescanTripDocument: (id: number, docId: number, options?: RequestInit) => Promise<TravelsTripDocument>;
export declare const getRescanTripDocumentMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof rescanTripDocument>>, TError, {
        id: number;
        docId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof rescanTripDocument>>, TError, {
    id: number;
    docId: number;
}, TContext>;
export type RescanTripDocumentMutationResult = NonNullable<Awaited<ReturnType<typeof rescanTripDocument>>>;
export type RescanTripDocumentMutationError = ErrorType<Error>;
/**
* @summary Re-run AI extraction on a previously uploaded document, respecting locked fields
*/
export declare const useRescanTripDocument: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof rescanTripDocument>>, TError, {
        id: number;
        docId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof rescanTripDocument>>, TError, {
    id: number;
    docId: number;
}, TContext>;
export declare const getDownloadTripDocumentUrl: (id: number, docId: number) => string;
/**
 * @summary Download/view a trip document
 */
export declare const downloadTripDocument: (id: number, docId: number, options?: RequestInit) => Promise<Blob>;
export declare const getDownloadTripDocumentQueryKey: (id: number, docId: number) => readonly [`/api/travels/trips/${number}/documents/${number}/download`];
export declare const getDownloadTripDocumentQueryOptions: <TData = Awaited<ReturnType<typeof downloadTripDocument>>, TError = ErrorType<Error>>(id: number, docId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof downloadTripDocument>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof downloadTripDocument>>, TError, TData> & {
    queryKey: QueryKey;
};
export type DownloadTripDocumentQueryResult = NonNullable<Awaited<ReturnType<typeof downloadTripDocument>>>;
export type DownloadTripDocumentQueryError = ErrorType<Error>;
/**
 * @summary Download/view a trip document
 */
export declare function useDownloadTripDocument<TData = Awaited<ReturnType<typeof downloadTripDocument>>, TError = ErrorType<Error>>(id: number, docId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof downloadTripDocument>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getExploreDestinationUrl: () => string;
/**
 * @summary Get a map location and AI overview for a destination
 */
export declare const exploreDestination: (travelsExploreDestinationBody: TravelsExploreDestinationBody, options?: RequestInit) => Promise<TravelsExploreDestinationResult>;
export declare const getExploreDestinationMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof exploreDestination>>, TError, {
        data: BodyType<TravelsExploreDestinationBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof exploreDestination>>, TError, {
    data: BodyType<TravelsExploreDestinationBody>;
}, TContext>;
export type ExploreDestinationMutationResult = NonNullable<Awaited<ReturnType<typeof exploreDestination>>>;
export type ExploreDestinationMutationBody = BodyType<TravelsExploreDestinationBody>;
export type ExploreDestinationMutationError = ErrorType<Error>;
/**
* @summary Get a map location and AI overview for a destination
*/
export declare const useExploreDestination: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof exploreDestination>>, TError, {
        data: BodyType<TravelsExploreDestinationBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof exploreDestination>>, TError, {
    data: BodyType<TravelsExploreDestinationBody>;
}, TContext>;
export declare const getGetTravelsStatsUrl: () => string;
/**
 * @summary Get travel statistics for the current user
 */
export declare const getTravelsStats: (options?: RequestInit) => Promise<TravelsTravelsStatsResponse>;
export declare const getGetTravelsStatsQueryKey: () => readonly ["/api/travels/stats"];
export declare const getGetTravelsStatsQueryOptions: <TData = Awaited<ReturnType<typeof getTravelsStats>>, TError = ErrorType<Error>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getTravelsStats>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getTravelsStats>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetTravelsStatsQueryResult = NonNullable<Awaited<ReturnType<typeof getTravelsStats>>>;
export type GetTravelsStatsQueryError = ErrorType<Error>;
/**
 * @summary Get travel statistics for the current user
 */
export declare function useGetTravelsStats<TData = Awaited<ReturnType<typeof getTravelsStats>>, TError = ErrorType<Error>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getTravelsStats>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetPackingListUrl: (id: number) => string;
/**
 * @summary Get (or auto-create) the packing list and items for a trip
 */
export declare const getPackingList: (id: number, options?: RequestInit) => Promise<TravelsPackingListWithItems>;
export declare const getGetPackingListQueryKey: (id: number) => readonly [`/api/travels/trips/${number}/packing`];
export declare const getGetPackingListQueryOptions: <TData = Awaited<ReturnType<typeof getPackingList>>, TError = ErrorType<Error>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPackingList>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getPackingList>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetPackingListQueryResult = NonNullable<Awaited<ReturnType<typeof getPackingList>>>;
export type GetPackingListQueryError = ErrorType<Error>;
/**
 * @summary Get (or auto-create) the packing list and items for a trip
 */
export declare function useGetPackingList<TData = Awaited<ReturnType<typeof getPackingList>>, TError = ErrorType<Error>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPackingList>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreatePackingItemUrl: (id: number) => string;
/**
 * @summary Add an item to a trip's packing list
 */
export declare const createPackingItem: (id: number, travelsCreatePackingItemBody: TravelsCreatePackingItemBody, options?: RequestInit) => Promise<TravelsPackingItem>;
export declare const getCreatePackingItemMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createPackingItem>>, TError, {
        id: number;
        data: BodyType<TravelsCreatePackingItemBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createPackingItem>>, TError, {
    id: number;
    data: BodyType<TravelsCreatePackingItemBody>;
}, TContext>;
export type CreatePackingItemMutationResult = NonNullable<Awaited<ReturnType<typeof createPackingItem>>>;
export type CreatePackingItemMutationBody = BodyType<TravelsCreatePackingItemBody>;
export type CreatePackingItemMutationError = ErrorType<Error>;
/**
* @summary Add an item to a trip's packing list
*/
export declare const useCreatePackingItem: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createPackingItem>>, TError, {
        id: number;
        data: BodyType<TravelsCreatePackingItemBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createPackingItem>>, TError, {
    id: number;
    data: BodyType<TravelsCreatePackingItemBody>;
}, TContext>;
export declare const getReorderPackingItemsUrl: (id: number) => string;
/**
 * @summary Batch-update sort order for packing items (drag-and-drop reorder)
 */
export declare const reorderPackingItems: (id: number, travelsReorderPackingItemsBody: TravelsReorderPackingItemsBody, options?: RequestInit) => Promise<ReorderPackingItems200>;
export declare const getReorderPackingItemsMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof reorderPackingItems>>, TError, {
        id: number;
        data: BodyType<TravelsReorderPackingItemsBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof reorderPackingItems>>, TError, {
    id: number;
    data: BodyType<TravelsReorderPackingItemsBody>;
}, TContext>;
export type ReorderPackingItemsMutationResult = NonNullable<Awaited<ReturnType<typeof reorderPackingItems>>>;
export type ReorderPackingItemsMutationBody = BodyType<TravelsReorderPackingItemsBody>;
export type ReorderPackingItemsMutationError = ErrorType<Error>;
/**
* @summary Batch-update sort order for packing items (drag-and-drop reorder)
*/
export declare const useReorderPackingItems: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof reorderPackingItems>>, TError, {
        id: number;
        data: BodyType<TravelsReorderPackingItemsBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof reorderPackingItems>>, TError, {
    id: number;
    data: BodyType<TravelsReorderPackingItemsBody>;
}, TContext>;
export declare const getBulkCreatePackingItemsUrl: (id: number) => string;
/**
 * @summary Add multiple items to a trip's packing list
 */
export declare const bulkCreatePackingItems: (id: number, travelsBulkCreatePackingItemsBody: TravelsBulkCreatePackingItemsBody, options?: RequestInit) => Promise<TravelsPackingItem[]>;
export declare const getBulkCreatePackingItemsMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof bulkCreatePackingItems>>, TError, {
        id: number;
        data: BodyType<TravelsBulkCreatePackingItemsBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof bulkCreatePackingItems>>, TError, {
    id: number;
    data: BodyType<TravelsBulkCreatePackingItemsBody>;
}, TContext>;
export type BulkCreatePackingItemsMutationResult = NonNullable<Awaited<ReturnType<typeof bulkCreatePackingItems>>>;
export type BulkCreatePackingItemsMutationBody = BodyType<TravelsBulkCreatePackingItemsBody>;
export type BulkCreatePackingItemsMutationError = ErrorType<Error>;
/**
* @summary Add multiple items to a trip's packing list
*/
export declare const useBulkCreatePackingItems: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof bulkCreatePackingItems>>, TError, {
        id: number;
        data: BodyType<TravelsBulkCreatePackingItemsBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof bulkCreatePackingItems>>, TError, {
    id: number;
    data: BodyType<TravelsBulkCreatePackingItemsBody>;
}, TContext>;
export declare const getUpdatePackingItemUrl: (id: number, itemId: number) => string;
/**
 * @summary Update a packing item (toggle packed, rename, reorder)
 */
export declare const updatePackingItem: (id: number, itemId: number, travelsUpdatePackingItemBody: TravelsUpdatePackingItemBody, options?: RequestInit) => Promise<TravelsPackingItem>;
export declare const getUpdatePackingItemMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updatePackingItem>>, TError, {
        id: number;
        itemId: number;
        data: BodyType<TravelsUpdatePackingItemBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updatePackingItem>>, TError, {
    id: number;
    itemId: number;
    data: BodyType<TravelsUpdatePackingItemBody>;
}, TContext>;
export type UpdatePackingItemMutationResult = NonNullable<Awaited<ReturnType<typeof updatePackingItem>>>;
export type UpdatePackingItemMutationBody = BodyType<TravelsUpdatePackingItemBody>;
export type UpdatePackingItemMutationError = ErrorType<Error>;
/**
* @summary Update a packing item (toggle packed, rename, reorder)
*/
export declare const useUpdatePackingItem: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updatePackingItem>>, TError, {
        id: number;
        itemId: number;
        data: BodyType<TravelsUpdatePackingItemBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updatePackingItem>>, TError, {
    id: number;
    itemId: number;
    data: BodyType<TravelsUpdatePackingItemBody>;
}, TContext>;
export declare const getDeletePackingItemUrl: (id: number, itemId: number) => string;
/**
 * @summary Remove a packing item
 */
export declare const deletePackingItem: (id: number, itemId: number, options?: RequestInit) => Promise<void>;
export declare const getDeletePackingItemMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deletePackingItem>>, TError, {
        id: number;
        itemId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deletePackingItem>>, TError, {
    id: number;
    itemId: number;
}, TContext>;
export type DeletePackingItemMutationResult = NonNullable<Awaited<ReturnType<typeof deletePackingItem>>>;
export type DeletePackingItemMutationError = ErrorType<Error>;
/**
* @summary Remove a packing item
*/
export declare const useDeletePackingItem: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deletePackingItem>>, TError, {
        id: number;
        itemId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deletePackingItem>>, TError, {
    id: number;
    itemId: number;
}, TContext>;
export declare const getLoadPackingTemplateUrl: (id: number, templateId: number) => string;
/**
 * @summary Merge a template's items into the trip's packing list
 */
export declare const loadPackingTemplate: (id: number, templateId: number, options?: RequestInit) => Promise<TravelsLoadTemplateResult>;
export declare const getLoadPackingTemplateMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof loadPackingTemplate>>, TError, {
        id: number;
        templateId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof loadPackingTemplate>>, TError, {
    id: number;
    templateId: number;
}, TContext>;
export type LoadPackingTemplateMutationResult = NonNullable<Awaited<ReturnType<typeof loadPackingTemplate>>>;
export type LoadPackingTemplateMutationError = ErrorType<Error>;
/**
* @summary Merge a template's items into the trip's packing list
*/
export declare const useLoadPackingTemplate: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof loadPackingTemplate>>, TError, {
        id: number;
        templateId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof loadPackingTemplate>>, TError, {
    id: number;
    templateId: number;
}, TContext>;
export declare const getListPackingTemplatesUrl: () => string;
/**
 * @summary List all saved packing templates
 */
export declare const listPackingTemplates: (options?: RequestInit) => Promise<TravelsPackingTemplate[]>;
export declare const getListPackingTemplatesQueryKey: () => readonly ["/api/travels/packing-templates"];
export declare const getListPackingTemplatesQueryOptions: <TData = Awaited<ReturnType<typeof listPackingTemplates>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listPackingTemplates>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listPackingTemplates>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListPackingTemplatesQueryResult = NonNullable<Awaited<ReturnType<typeof listPackingTemplates>>>;
export type ListPackingTemplatesQueryError = ErrorType<unknown>;
/**
 * @summary List all saved packing templates
 */
export declare function useListPackingTemplates<TData = Awaited<ReturnType<typeof listPackingTemplates>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listPackingTemplates>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreatePackingTemplateUrl: () => string;
/**
 * @summary Save a new packing template
 */
export declare const createPackingTemplate: (travelsCreatePackingTemplateBody: TravelsCreatePackingTemplateBody, options?: RequestInit) => Promise<TravelsPackingTemplate>;
export declare const getCreatePackingTemplateMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createPackingTemplate>>, TError, {
        data: BodyType<TravelsCreatePackingTemplateBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createPackingTemplate>>, TError, {
    data: BodyType<TravelsCreatePackingTemplateBody>;
}, TContext>;
export type CreatePackingTemplateMutationResult = NonNullable<Awaited<ReturnType<typeof createPackingTemplate>>>;
export type CreatePackingTemplateMutationBody = BodyType<TravelsCreatePackingTemplateBody>;
export type CreatePackingTemplateMutationError = ErrorType<unknown>;
/**
* @summary Save a new packing template
*/
export declare const useCreatePackingTemplate: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createPackingTemplate>>, TError, {
        data: BodyType<TravelsCreatePackingTemplateBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createPackingTemplate>>, TError, {
    data: BodyType<TravelsCreatePackingTemplateBody>;
}, TContext>;
export declare const getDeletePackingTemplateUrl: (templateId: number) => string;
/**
 * @summary Delete a packing template
 */
export declare const deletePackingTemplate: (templateId: number, options?: RequestInit) => Promise<void>;
export declare const getDeletePackingTemplateMutationOptions: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deletePackingTemplate>>, TError, {
        templateId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deletePackingTemplate>>, TError, {
    templateId: number;
}, TContext>;
export type DeletePackingTemplateMutationResult = NonNullable<Awaited<ReturnType<typeof deletePackingTemplate>>>;
export type DeletePackingTemplateMutationError = ErrorType<Error>;
/**
* @summary Delete a packing template
*/
export declare const useDeletePackingTemplate: <TError = ErrorType<Error>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deletePackingTemplate>>, TError, {
        templateId: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deletePackingTemplate>>, TError, {
    templateId: number;
}, TContext>;
export {};
//# sourceMappingURL=api.d.ts.map