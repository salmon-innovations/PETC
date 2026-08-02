package com.petc.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.util.UUID;

/**
 * Cross-tenant operator-portal account.  Unlike {@link User}, a super admin
 * has no owning tenant: the JWT it produces carries a null tenantId, which
 * leaves app.tenant_id unset and lets the RLS policies read across tenants.
 */
@Entity
@Table(name = "super_admin_users")
public class SuperAdminUser {

    @Id
    private UUID id;

    @Column(nullable = false, unique = true)
    private String email;

    @Column(name = "password_hash", nullable = false)
    private String passwordHash;

    protected SuperAdminUser() {}

    public UUID getId() {
        return id;
    }

    public String getEmail() {
        return email;
    }

    public String getPasswordHash() {
        return passwordHash;
    }
}
