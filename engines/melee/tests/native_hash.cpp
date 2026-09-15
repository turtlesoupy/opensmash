#include "moderngekko/game.hpp"
#undef NDEBUG
#include <cassert>
#include <filesystem>
#include <fstream>

int main(int argc, char** argv) {
    assert(argc == 2);
    const std::filesystem::path path = argv[1];
    assert(!std::filesystem::exists(path));
    assert(!moderngekko::HashFileSha256(path));
    { std::ofstream file(path, std::ios::binary); }
    assert(moderngekko::HashFileSha256(path) ==
           "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    { std::ofstream file(path, std::ios::binary); file << "abc"; }
    assert(moderngekko::HashFileSha256(path) ==
           "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    {
        std::ofstream file(path, std::ios::binary);
        for (int block = 0; block < 4097; ++block)
            for (int byte = 0; byte < 256; ++byte)
                file.put(static_cast<char>(byte));
    }
    assert(moderngekko::HashFileSha256(path) ==
           "dd7e5c49d123e860c8bb7016bada722b5d0baa37ef8b19d5e270cf2a3000c31d");
    std::filesystem::remove(path);
    const auto directory = std::filesystem::path(path.string() + ".directory");
    assert(!std::filesystem::exists(directory));
    std::filesystem::create_directory(directory);
    { std::ofstream file(directory / "z.txt", std::ios::binary); file << "abc"; }
    { std::ofstream file(directory / "a.txt", std::ios::binary); }
    assert(moderngekko::HashDirectorySha256(directory) ==
           "3d1c9a2d89442572ee9bdf6619cd5901f8f19de5cbd7b683d366dcce8f0d704f");
    std::filesystem::remove(directory / "a.txt");
    std::filesystem::remove(directory / "z.txt");
    std::filesystem::remove(directory);
}
