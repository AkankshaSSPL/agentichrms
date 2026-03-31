import os

# 👉 Change path if needed
base_path = r"D:\face_project\dataset_cropped"

print("Base Path Exists:", os.path.exists(base_path))

if not os.path.exists(base_path):
    print("❌ Folder not found.")
    exit()

for person in os.listdir(base_path):

    person_path = os.path.join(base_path, person)

    if not os.path.isdir(person_path):
        continue

    print(f"\nProcessing folder: {person}")

    images = os.listdir(person_path)
    images.sort()

    count = 1

    for img in images:

        old_path = os.path.join(person_path, img)

        if not os.path.isfile(old_path):
            continue

        if not img.lower().endswith((".jpg", ".jpeg", ".png")):
            continue

        # 👉 FORMAT: rahul001.jpg
        new_name = f"{person.lower()}{count:03d}.jpg"
        new_path = os.path.join(person_path, new_name)

        # Skip if already correctly renamed
        if img == new_name:
            count += 1
            continue

        # Avoid overwrite crash
        if os.path.exists(new_path):
            print(f"File exists, skipping: {new_name}")
            count += 1
            continue

        try:
            os.rename(old_path, new_path)
            print(f"Renamed: {img} -> {new_name}")
            count += 1
        except Exception as e:
            print(f"Error renaming {img}: {e}")

print("\nRenaming completed safely ✅")


""" import os

base_path = "D:\\face_project\\dataset_cropped"   # change if needed

print("Base Path Exists:", os.path.exists(base_path))
print("Folders Found:", os.listdir(base_path))


for person in os.listdir(base_path):
    person_path = os.path.join(base_path, person)

    if os.path.isdir(person_path):
        print("Processing:", person)

        images = os.listdir(person_path)
        images.sort()   # sort for consistent numbering

        count = 1

        for img in images:
            old_path = os.path.join(person_path, img)

            # Create new name like supriya001.jpg
            new_name = f"{person.lower()}{count:03d}.jpg"
            
            new_path = os.path.join(person_path, new_name)

            os.rename(old_path, new_path)

            count += 1

print("Renaming completed ✅")
 """

 