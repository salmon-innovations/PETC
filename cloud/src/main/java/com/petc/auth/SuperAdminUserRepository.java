package com.petc.auth;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface SuperAdminUserRepository extends JpaRepository<SuperAdminUser, UUID> {

    Optional<SuperAdminUser> findByEmail(String email);
}
