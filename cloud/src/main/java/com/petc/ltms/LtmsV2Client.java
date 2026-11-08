package com.petc.ltms;

import com.petc.ltms.LtmsDtos.CecReplaceRequest;
import com.petc.ltms.LtmsDtos.CecSearchRequest;
import com.petc.ltms.LtmsDtos.CecUploadRequest;
import com.petc.ltms.LtmsDtos.LimitsRequest;
import com.petc.ltms.LtmsDtos.Response;
import com.petc.ltms.LtmsDtos.UploadLimitsRequest;
import com.petc.ltms.LtmsDtos.VehicleSearchRequest;

/** Dedicated PETC v2 transport boundary; it is not the legacy registry adapter. */
public interface LtmsV2Client {
    Response getLimits(LtmsRequestContext context, LimitsRequest request);
    Response searchVehicle(LtmsRequestContext context, VehicleSearchRequest request);
    Response upload(LtmsRequestContext context, CecUploadRequest request);
    Response replace(LtmsRequestContext context, CecReplaceRequest request);
    Response searchCec(LtmsRequestContext context, CecSearchRequest request);
    Response getUploadLimits(LtmsRequestContext context, UploadLimitsRequest request);
}
