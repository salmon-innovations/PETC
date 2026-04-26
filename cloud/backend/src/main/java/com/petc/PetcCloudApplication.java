package com.petc;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;

@SpringBootApplication
@EnableAsync
public class PetcCloudApplication {
    public static void main(String[] args) {
        SpringApplication.run(PetcCloudApplication.class, args);
    }
}
