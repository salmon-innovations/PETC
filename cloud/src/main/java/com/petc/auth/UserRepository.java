package com.petc.auth;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface UserRepository extends JpaRepository<User, UUID> {

    @Query("""
            SELECT u FROM User u
            JOIN u.tenant t
            WHERE u.email = :email AND t.slug = :slug
            """)
    Optional<User> findByEmailAndTenantSlug(@Param("email") String email, @Param("slug") String slug);
}
