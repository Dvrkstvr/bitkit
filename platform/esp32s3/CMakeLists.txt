# PocketBit firmware: the BitKit runtime + device host on an ESP32-S3 (ESP-IDF 5.3).
# Before the first build: node tools/export_device.cjs   (puts the built-in games and apps in flash/)
cmake_minimum_required(VERSION 3.16)
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(pocketbit)

# The built-in games, apps and home screen go into the internal flash as a FAT disk (/flash), with room for saves.
set(FLASH_DIR ${CMAKE_CURRENT_LIST_DIR}/flash)
if(NOT EXISTS ${FLASH_DIR}/sys/home.lua)
  message(FATAL_ERROR "No games to put on the Bit: run `node tools/export_device.cjs` in the bitkit folder first.")
endif()
fatfs_create_spiflash_image(storage ${FLASH_DIR} FLASH_IN_PROJECT)
