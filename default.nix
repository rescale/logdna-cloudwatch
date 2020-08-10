let
  pkgs = import <nixpkgs> {};
  stdenv = pkgs.stdenv;
in stdenv.mkDerivation rec {
  name = "logdna-cloudwatch";
  env = pkgs.buildEnv { name = name; paths = buildInputs; };

  buildInputs = [
    pkgs.nodejs-10_x
    pkgs.awscli
  ];
  shellHook = (
  ''
  ''
  );
}
