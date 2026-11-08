package com.petc.ltms;

import com.petc.ltms.LtmsDtos.*;

/** Default client. It has no HTTP dependencies and cannot initiate a connection. */
public final class DisabledLtmsV2Client implements LtmsV2Client {
    private Response disabled() { throw new LtmsDisabledException(); }
    public Response getLimits(LtmsRequestContext context, LimitsRequest request) { return disabled(); }
    public Response searchVehicle(LtmsRequestContext context, VehicleSearchRequest request) { return disabled(); }
    public Response upload(LtmsRequestContext context, CecUploadRequest request) { return disabled(); }
    public Response replace(LtmsRequestContext context, CecReplaceRequest request) { return disabled(); }
    public Response searchCec(LtmsRequestContext context, CecSearchRequest request) { return disabled(); }
    public Response getUploadLimits(LtmsRequestContext context, UploadLimitsRequest request) { return disabled(); }
}
