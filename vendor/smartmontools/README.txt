smartctl 7.5 (macOS ARM64), lokal kompiliert aus dem unveränderten
smartmontools-7.5-Quellarchiv (SVN r5714 vom 2025-04-30).

Freigegebene Binärdatei SHA-256:
ba9691d84342c36420fb022141abd3922129ddad4d2e653a93ca3e9ec2f0ddce

Offizielles smartmontools-7.5-Quellarchiv SHA-256:
690b83ca331378da9ea0d9d61008c4b22dde391387b9bbad7f29387f2595f76e

Build-System: Apple Silicon arm64, macOS 27.0.1, Xcode 27.2 SDK,
Apple clang 21.0.0, Deployment-Ziel macOS 15.0.
Der Build-Host (Darwin 27) bestimmt NICHT die Mindestversion.
Im Mach-O-Header LC_BUILD_VERSION steht minos 15.0 und sdk 27.2.

Configure-Argumente:
./configure --disable-dependency-tracking --with-savestates \
  --with-attributelog --with-nvme-devicescan

Build-Umgebung:
MACOSX_DEPLOYMENT_TARGET=15.0
SDKROOT=$(xcrun --sdk macosx --show-sdk-path)
CC=$(xcrun --find clang)
CXX=$(xcrun --find clang++)
CFLAGS='-arch arm64 -mmacosx-version-min=15.0'
CXXFLAGS='-arch arm64 -mmacosx-version-min=15.0'
LDFLAGS='-arch arm64 -mmacosx-version-min=15.0'

Build: make -j"$(sysctl -n hw.ncpu)" smartctl

Validierung: file ./smartctl; xcrun vtool -show-build ./smartctl;
./smartctl --version; shasum -a 256 ./smartctl.
