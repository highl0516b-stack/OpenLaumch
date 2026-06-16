variable "IMAGE_WEB" {
  default = "openlaunch:local"
}

variable "IMAGE_API" {
  default = "openlaunch-api:local"
}

group "default" {
  targets = ["web", "api"]
}

target "web" {
  dockerfile = "Dockerfile"
  tags       = [IMAGE_WEB]
}

target "api" {
  dockerfile = "Dockerfile.api"
  tags       = [IMAGE_API]
}
