import pathlib

path = pathlib.Path(__file__).resolve().parents[1] / "FitnessOSCompanion.xcodeproj" / "project.pbxproj"
text = path.read_text()

text = text.replace('CODE_SIGN_IDENTITY = "iPhone Developer";', 'CODE_SIGN_IDENTITY = "Apple Development";')

needle = '''\t\t\t\t\t792EA1481984A6776C81FE3D = {
\t\t\t\t\t\tDevelopmentTeam = "";
\t\t\t\t\t\tProvisioningStyle = Automatic;
\t\t\t\t\t};'''
replacement = '''\t\t\t\t\t792EA1481984A6776C81FE3D = {
\t\t\t\t\t\tDevelopmentTeam = "";
\t\t\t\t\t\tProvisioningStyle = Automatic;
\t\t\t\t\t\tSystemCapabilities = {
\t\t\t\t\t\t\tcom.apple.HealthKit = {
\t\t\t\t\t\t\t\tenabled = 1;
\t\t\t\t\t\t\t};
\t\t\t\t\t\t};
\t\t\t\t\t};'''
if "SystemCapabilities" not in text:
    if needle not in text:
        raise SystemExit("Could not find target attributes to patch")
    text = text.replace(needle, replacement)

path.write_text(text)
print("Patched HealthKit capability and Apple Development signing identity")
