{
  "targets": [{
    "target_name": "surface",
    "sources": ["surface.mm"],
    "defines": ["NAPI_VERSION=8"],
    "xcode_settings": {"CLANG_CXX_LANGUAGE_STANDARD": "c++17", "MACOSX_DEPLOYMENT_TARGET": "14.0"},
    "link_settings": {"libraries": ["-framework IOSurface", "-framework Foundation"]}
  }]
}
