# The BitKit runtime (runtime/), the portable device host (platform/device/) and Lua 5.4, plus the drivers here.
set(ROOT ${CMAKE_CURRENT_LIST_DIR}/../../..)
file(GLOB RUNTIME_SRC ${ROOT}/runtime/*.c)
file(GLOB HOST_SRC ${ROOT}/platform/device/*.c)
file(GLOB LUA_SRC ${ROOT}/third_party/lua/*.c)
list(FILTER LUA_SRC EXCLUDE REGEX ".*/(lua|luac|loadlib|liolib|loslib|ldblib|linit)\\.c$")

idf_component_register(
  SRCS main.c lcd.c audio.c input.c storage.c clock.c radio.c ${RUNTIME_SRC} ${HOST_SRC} ${LUA_SRC}
  INCLUDE_DIRS . ${ROOT}/runtime ${ROOT}/platform/device ${ROOT}/third_party/lua ${ROOT}/third_party
  REQUIRES esp_lcd fatfs sdmmc esp_timer esp_psram vfs wear_levelling
           esp_driver_i2s esp_driver_gpio esp_driver_ledc esp_driver_spi esp_driver_sdmmc esp_driver_i2c
           esp_wifi esp_netif esp_event nvs_flash)

# Lua: the same fixed seed as the browser build (deterministic games); big runtime buffers go to PSRAM
target_compile_options(${COMPONENT_LIB} PRIVATE "-Dluai_makeseed(L)=0x2545F491u" -O2 -Wno-error -Wno-unused-function -Wno-format-truncation -Wno-misleading-indentation)
target_compile_definitions(${COMPONENT_LIB} PRIVATE "BK_BIG_BSS=__attribute__((section(\".ext_ram.bss\")))")
